package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"repo-berth/internal/model"
	"repo-berth/internal/provider"
)

// This type is deliberately private and never persisted or returned through Wails.
type authorizedIdentity struct {
	user            provider.User
	token           string
	targetAccountID string
	expiresAt       time.Time
	resumeTaskID    string
	expiryTimer     *time.Timer
}

func (s *Service) retainAuthorization(taskID string, data authorizedIdentity, err error) {
	var appErr *model.AppError
	if !errors.As(err, &appErr) || (appErr.Code != "VAULT_UNAVAILABLE" && appErr.Code != "STORAGE_WRITE") || s.ctx.Err() != nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if time.Now().Before(data.expiresAt) {
		data.resumeTaskID = ""
		s.discardAuthorizationLocked(taskID)
		expires := data.expiresAt
		data.expiryTimer = time.AfterFunc(time.Until(expires), func() {
			s.mu.Lock()
			pending := s.pendingAuthorizations[taskID]
			if pending == nil || !pending.expiresAt.Equal(expires) {
				s.mu.Unlock()
				return
			}
			cancel := s.tasks[pending.resumeTaskID]
			s.discardAuthorizationLocked(taskID)
			emit := s.emit
			s.mu.Unlock()
			if cancel != nil {
				cancel()
			}
			emit("state:changed", nil)
		})
		s.pendingAuthorizations[taskID] = &data
	}
}

// Caller holds s.mu. Stop the expiry timer before dropping the only retained copy.
func (s *Service) discardAuthorizationLocked(taskID string) {
	if pending := s.pendingAuthorizations[taskID]; pending != nil && pending.expiryTimer != nil {
		pending.expiryTimer.Stop()
	}
	delete(s.pendingAuthorizations, taskID)
}

func (s *Service) saveAuthorization(ctx context.Context, taskID string, data authorizedIdentity, sessionOnly bool) error {
	if !time.Now().Before(data.expiresAt) {
		return model.Err("AUTH_RECOVERY_EXPIRED", "本次授权恢复已过期，请重新打开浏览器授权")
	}
	identity := fmt.Sprintf("github:github.com:%d", data.user.ID)
	accountLock := s.accountLock(identity)
	if err := accountLock.Lock(ctx); err != nil {
		return err
	}
	defer accountLock.Unlock()
	if err := s.credentialLock.Lock(ctx); err != nil {
		return err
	}
	defer s.credentialLock.Unlock()
	if data.targetAccountID != "" {
		old, err := s.account(data.targetAccountID)
		if err != nil {
			return err
		}
		if old.UserID != data.user.ID {
			return model.Err("ACCOUNT_MISMATCH", "浏览器授权了其他账号，请切换到原账号后重试")
		}
	}
	current, err := s.Snapshot()
	if err != nil {
		return err
	}
	colors := []string{"#1b6c80", "#945e13", "#27663f", "#9c4357", "#4e5d6c"}
	account := model.Account{ID: model.ID(), Provider: "github", Host: "github.com", UserID: data.user.ID, Login: data.user.Login, Name: data.user.Name, Avatar: data.user.Avatar, Color: colors[len(current.Accounts)%len(colors)], Status: "connected", SessionOnly: sessionOnly}
	oldRef := ""
	for _, old := range current.Accounts {
		if accountIdentity(old) == identity {
			account.ID = old.ID
			account.Note = old.Note
			account.Color = old.Color
			account.SyncedAt = old.SyncedAt
			oldRef = old.CredentialRef
			data.targetAccountID = old.ID
			break
		}
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	// Never replace an in-use secret. A durable candidate record precedes the
	// keychain write, so an interrupted save can be reclaimed on next startup.
	newRef := identity + ":" + model.ID()
	account.CredentialRef = newRef
	s.mu.Lock()
	s.inflightCredentials[newRef] = true
	s.mu.Unlock()
	defer func() { s.mu.Lock(); delete(s.inflightCredentials, newRef); s.mu.Unlock() }()
	if err = s.addCredentialCandidates(newRef, oldRef); err != nil {
		err = model.Err("STORAGE_WRITE", "GitHub 授权已完成，但本地记录无法保存；修复磁盘或目录权限后可重试保存")
		s.retainAuthorization(taskID, data, err)
		return err
	}
	if err = s.vault.Set(newRef, data.token, sessionOnly); err != nil {
		_ = s.cleanupCredentialsLocked(s.ctx)
		err = model.Err("VAULT_UNAVAILABLE", "GitHub 授权已完成，但系统凭据库无法保存；可重试，或明确选择仅本次会话保存")
		s.retainAuthorization(taskID, data, err)
		return err
	}
	if err = ctx.Err(); err != nil {
		_ = s.cleanupCredentialsLocked(s.ctx)
		return err
	}
	err = s.change(func(st *model.State) error {
		for i := range st.Accounts {
			if st.Accounts[i].ID == account.ID {
				st.Accounts[i] = account
				return nil
			}
		}
		st.Accounts = append(st.Accounts, account)
		return nil
	})
	if err != nil {
		_ = s.cleanupCredentialsLocked(s.ctx)
		err = model.Err("STORAGE_WRITE", "授权凭据未替换旧账号；本地记录保存失败，修复后可继续保存本次授权")
		s.retainAuthorization(taskID, data, err)
		return err
	}
	s.mu.Lock()
	s.discardAuthorizationLocked(taskID)
	s.mu.Unlock()
	_ = s.updateTask(taskID, func(t *model.Task) { t.Target = account.ID; t.Progress = "已连接账号 " + account.Login })
	// Cleanup failure does not invalidate the newly committed account. The durable
	// journal and public pending count make deferred removal explicit and retryable.
	_ = s.cleanupCredentialsLocked(s.ctx)
	return nil
}

func (s *Service) RecoverAuthorization(taskID string, sessionOnly bool) (string, error) {
	s.mu.Lock()
	pending, ok := s.pendingAuthorizations[taskID]
	if !ok || !time.Now().Before(pending.expiresAt) {
		s.discardAuthorizationLocked(taskID)
		s.mu.Unlock()
		return "", model.Err("AUTH_RECOVERY_EXPIRED", "本次授权恢复已过期，请重新打开浏览器授权")
	}
	if pending.resumeTaskID != "" {
		s.mu.Unlock()
		return "", model.Err("AUTH_RECOVERY_BUSY", "本次授权正在保存，请等待任务完成")
	}
	pending.resumeTaskID = "starting"
	data := *pending
	s.mu.Unlock()
	ready := make(chan struct{})
	id, err := s.task("authorize", data.targetAccountID, func(ctx context.Context, nextID string) error {
		select {
		case <-ready:
		case <-ctx.Done():
			return ctx.Err()
		}
		_ = s.updateTask(nextID, func(t *model.Task) { t.Progress = "正在保存已完成的 GitHub 授权" })
		err := s.saveAuthorization(ctx, nextID, data, sessionOnly)
		if ctx.Err() == nil {
			s.mu.Lock()
			s.discardAuthorizationLocked(taskID)
			s.mu.Unlock()
		}
		return err
	})
	s.mu.Lock()
	if pending, ok = s.pendingAuthorizations[taskID]; ok {
		if err != nil {
			pending.resumeTaskID = ""
		} else {
			pending.resumeTaskID = id
		}
	} else if err == nil {
		if cancel := s.tasks[id]; cancel != nil {
			cancel()
		}
	}
	s.mu.Unlock()
	close(ready)
	return id, err
}

func (s *Service) addCredentialCandidates(refs ...string) error {
	return s.change(func(st *model.State) error {
		seen := map[string]bool{}
		for _, ref := range st.CredentialCleanup {
			seen[ref] = true
		}
		for _, ref := range refs {
			if ref != "" && !seen[ref] {
				st.CredentialCleanup = append(st.CredentialCleanup, ref)
				seen[ref] = true
			}
		}
		return nil
	})
}

// Caller holds credentialLock, preventing publication/removal during reclamation.
func (s *Service) cleanupCredentialsLocked(ctx context.Context) error {
	s.mu.Lock()
	refs := append([]string{}, s.state.CredentialCleanup...)
	active := map[string]bool{}
	for _, a := range s.state.Accounts {
		active[a.CredentialRef] = true
	}
	s.mu.Unlock()
	resolved := map[string]bool{}
	failed := false
	for _, ref := range refs {
		if err := ctx.Err(); err != nil {
			return err
		}
		if ref == "" {
			resolved[ref] = true
			continue
		}
		if active[ref] {
			resolved[ref] = true
			continue
		}
		if err := s.vault.Delete(ref); err != nil {
			failed = true
			continue
		}
		resolved[ref] = true
	}
	if len(resolved) > 0 {
		if err := s.change(func(st *model.State) error {
			remaining := []string{}
			for _, ref := range st.CredentialCleanup {
				if !resolved[ref] {
					remaining = append(remaining, ref)
				}
			}
			st.CredentialCleanup = remaining
			return nil
		}); err != nil {
			return model.Err("STORAGE_WRITE", "凭据清理记录无法保存，请检查本地磁盘与目录权限")
		}
	}
	if failed {
		return model.Err("CREDENTIAL_CLEANUP_PENDING", "部分旧凭据尚未清理；请解锁系统凭据库后重试，当前账号不会使用这些旧凭据")
	}
	return nil
}

func (s *Service) RetryCredentialCleanup() (string, error) {
	return s.task("credential_cleanup", "", func(ctx context.Context, _ string) error {
		if err := s.credentialLock.Lock(ctx); err != nil {
			return err
		}
		defer s.credentialLock.Unlock()
		return s.cleanupCredentialsLocked(ctx)
	})
}
