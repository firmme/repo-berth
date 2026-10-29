package service

import (
	"context"
	"fmt"

	"repo-berth/internal/model"
	"repo-berth/internal/provider"
	"strings"
	"time"
)

type Authorization struct {
	TaskID          string `json:"taskId"`
	UserCode        string `json:"userCode"`
	VerificationURI string `json:"verificationUri"`
	ExpiresIn       int    `json:"expiresIn"`
}

func (s *Service) StartAuthorization(sessionOnly bool, reauthorizeID string) (Authorization, error) {
	st, err := s.Snapshot()
	if err != nil {
		return Authorization{}, err
	}
	client := effectiveGitHubClientID(st.Settings.ClientID)
	if client == "" {
		return Authorization{}, model.Err("AUTH_BUILD_UNCONFIGURED", "此构建缺少 GitHub 登录配置，请使用已配置登录的应用版本；使用者无需注册 OAuth 应用")
	}
	if reauthorizeID != "" {
		if _, err = s.account(reauthorizeID); err != nil {
			return Authorization{}, err
		}
	}
	ctx, cancel := context.WithTimeout(s.ctx, 30*time.Second)
	defer cancel()
	code, err := s.provider.StartDevice(ctx, client)
	if err != nil {
		return Authorization{}, err
	}
	id, err := s.task("authorize", reauthorizeID, func(ctx context.Context, taskID string) error {
		_ = s.updateTask(taskID, func(t *model.Task) { t.Progress = "等待浏览器确认授权" })
		token, err := s.provider.PollDevice(ctx, client, code)
		if err != nil {
			return err
		}
		u, err := s.provider.CurrentUser(ctx, token)
		if err != nil {
			return err
		}
		data := authorizedIdentity{user: u, token: token, targetAccountID: reauthorizeID, expiresAt: time.Now().Add(10 * time.Minute)}
		return s.saveAuthorization(ctx, taskID, data, sessionOnly)
	})
	if err != nil {
		return Authorization{}, err
	}
	s.mu.Lock()
	d := s.desktop
	s.mu.Unlock()
	if d != nil {
		_ = d.OpenURL(code.VerificationURI)
	}
	return Authorization{TaskID: id, UserCode: code.UserCode, VerificationURI: code.VerificationURI, ExpiresIn: code.ExpiresIn}, nil
}
func (s *Service) AccountEmails(id string) ([]provider.Email, error) {
	a, err := s.account(id)
	if err != nil {
		return nil, err
	}
	t, err := s.vault.Get(a.CredentialRef)
	if err != nil {
		return nil, err
	}
	return s.provider.Emails(s.ctx, t)
}
func (s *Service) UpdateAccount(id, note, color string) error {
	if len(color) != 7 || color[0] != '#' {
		return model.Err("INVALID_COLOR", "颜色格式无效")
	}
	for _, ch := range color[1:] {
		if !strings.ContainsRune("0123456789abcdefABCDEF", ch) {
			return model.Err("INVALID_COLOR", "颜色格式无效")
		}
	}
	return s.change(func(st *model.State) error {
		for i := range st.Accounts {
			if st.Accounts[i].ID == id {
				st.Accounts[i].Note = strings.TrimSpace(note)
				st.Accounts[i].Color = color
				return nil
			}
		}
		return model.Err("ACCOUNT_MISSING", "账号不存在")
	})
}
func (s *Service) RemoveAccount(id string) error {
	a, err := s.account(id)
	if err != nil {
		return err
	}
	lock := s.accountLock(accountIdentity(a))
	if err := lock.Lock(s.ctx); err != nil {
		return err
	}
	defer lock.Unlock()
	if err = s.credentialLock.Lock(s.ctx); err != nil {
		return err
	}
	defer s.credentialLock.Unlock()
	a, err = s.account(id)
	if err != nil {
		return err
	}
	// Commit the removal and cleanup candidate atomically before touching the
	// keychain, so a failed DB write leaves the existing account usable.
	err = s.change(func(st *model.State) error {
		if a.CredentialRef != "" {
			exists := false
			for _, ref := range st.CredentialCleanup {
				if ref == a.CredentialRef {
					exists = true
					break
				}
			}
			if !exists {
				st.CredentialCleanup = append(st.CredentialCleanup, a.CredentialRef)
			}
		}
		accounts := []model.Account{}
		for _, v := range st.Accounts {
			if v.ID != id {
				accounts = append(accounts, v)
			}
		}
		st.Accounts = accounts
		if st.Settings.DefaultAccountID == id {
			st.Settings.DefaultAccountID = ""
		}
		access := []model.AccountRepository{}
		for _, v := range st.Access {
			if v.AccountID != id {
				access = append(access, v)
			}
		}
		st.Access = access
		for i := range st.Bindings {
			if st.Bindings[i].AccountID == id {
				st.Bindings[i].AccountID = ""
			}
		}
		return nil
	})
	if err != nil {
		return model.Err("STORAGE_WRITE", "账号记录无法移除；原凭据和仓库绑定已保留，请检查磁盘空间与目录权限")
	}
	s.mu.Lock()
	for taskID, pending := range s.pendingAuthorizations {
		if pending.targetAccountID == id {
			s.discardAuthorizationLocked(taskID)
		}
	}
	emit := s.emit
	s.mu.Unlock()
	emit("state:changed", nil)
	_ = s.cleanupCredentialsLocked(s.ctx)
	return nil
}
func (s *Service) SaveProfile(profile model.CommitProfile) (string, error) {
	profile.Name = strings.TrimSpace(profile.Name)
	profile.Email = strings.TrimSpace(profile.Email)
	if profile.Name == "" || !strings.Contains(profile.Email, "@") || strings.ContainsAny(profile.Name+profile.Email, "\r\n\x00<>") {
		return "", model.Err("INVALID_IDENTITY", "请确认有效的提交姓名和邮箱")
	}
	if _, err := s.account(profile.AccountID); err != nil {
		return "", err
	}
	if profile.ID == "" {
		profile.ID = model.ID()
	}
	err := s.change(func(st *model.State) error {
		accountExists := false
		for _, account := range st.Accounts {
			if account.ID == profile.AccountID {
				accountExists = true
				break
			}
		}
		if !accountExists {
			return model.Err("ACCOUNT_MISSING", "账号已移除，请重新选择")
		}
		for i := range st.Profiles {
			if st.Profiles[i].ID == profile.ID {
				if st.Profiles[i].AccountID != profile.AccountID {
					return model.Err("INVALID_IDENTITY", "不能把现有提交身份移动到其他账号")
				}
				st.Profiles[i] = profile
				return nil
			}
		}
		st.Profiles = append(st.Profiles, profile)
		return nil
	})
	return profile.ID, err
}
func (s *Service) DeleteProfile(id string) error {
	return s.change(func(st *model.State) error {
		for _, binding := range st.Bindings {
			if binding.ProfileID == id {
				return model.Err("PROFILE_IN_USE", "此身份仍被仓库使用，请先为相关 remote 选择其他提交身份")
			}
		}
		found := false
		profiles := []model.CommitProfile{}
		for _, profile := range st.Profiles {
			if profile.ID == id {
				found = true
			} else {
				profiles = append(profiles, profile)
			}
		}
		if !found {
			return model.Err("PROFILE_MISSING", "提交身份不存在")
		}
		st.Profiles = profiles
		return nil
	})
}
func (s *Service) markAuthFailure(id string, err error) {
	if e, ok := err.(*model.AppError); ok && e.Code == "AUTH_REQUIRED" {
		_ = s.change(func(st *model.State) error {
			for i := range st.Accounts {
				if st.Accounts[i].ID == id {
					st.Accounts[i].Status = "auth_required"
				}
			}
			return nil
		})
	}
}
func (s *Service) SyncRepositories(id string) (string, error) {
	a, err := s.account(id)
	if err != nil {
		return "", err
	}
	return s.task("sync", id, func(ctx context.Context, taskID string) error {
		lock := s.accountLock(accountIdentity(a))
		if err := lock.Lock(ctx); err != nil {
			return err
		}
		defer lock.Unlock()
		a, err := s.account(id)
		if err != nil {
			return err
		}
		t, err := s.vault.Get(a.CredentialRef)
		if err != nil {
			s.markAuthFailure(id, err)
			return err
		}
		repos, err := s.provider.Repositories(ctx, t)
		if err != nil {
			if e, ok := err.(*model.AppError); ok && e.Code == "AUTH_REQUIRED" {
				_ = s.change(func(st *model.State) error {
					for i := range st.Accounts {
						if st.Accounts[i].ID == id {
							st.Accounts[i].Status = "auth_required"
						}
					}
					return nil
				})
			}
			return err
		}
		if err = ctx.Err(); err != nil {
			return err
		}
		return s.change(func(st *model.State) error {
			access := []model.AccountRepository{}
			for _, v := range st.Access {
				if v.AccountID != id {
					access = append(access, v)
				}
			}
			for _, r := range repos {
				repoID := fmt.Sprintf("github:github.com:%d", r.ID)
				repo := model.RemoteRepository{ID: repoID, Provider: "github", Host: "github.com", PlatformID: r.ID, Owner: r.Owner.Login, Name: r.Name, Description: r.Description, URL: r.HTMLURL, CloneURL: r.CloneURL, Private: r.Private, Language: r.Language, UpdatedAt: r.UpdatedAt}
				found := false
				for i := range st.Repositories {
					if st.Repositories[i].ID == repoID {
						repo.Favorite = st.Repositories[i].Favorite
						repo.LastOpened = st.Repositories[i].LastOpened
						st.Repositories[i] = repo
						found = true
						break
					}
				}
				if !found {
					st.Repositories = append(st.Repositories, repo)
				}
				access = append(access, model.AccountRepository{ID: id + ":" + repoID, AccountID: id, RepositoryID: repoID, Push: r.Permissions.Push, SyncedAt: model.Now()})
			}
			st.Access = access
			for i := range st.Accounts {
				if st.Accounts[i].ID == id {
					st.Accounts[i].SyncedAt = model.Now()
					st.Accounts[i].Status = "connected"
				}
			}
			associate(st)
			return nil
		})
	})
}
