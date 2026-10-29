package service

import (
	"context"
	"os"
	"repo-berth/internal/gitexec"
	"repo-berth/internal/model"
	"time"
)

func (s *Service) GitStatus(id string) (gitexec.Status, error) {
	c, err := s.gitCheckout(id)
	if err != nil {
		return gitexec.Status{}, err
	}
	ctx, cancel := context.WithTimeout(s.ctx, 30*time.Second)
	defer cancel()
	return s.runner().Status(ctx, c.Path)
}
func (s *Service) GitDiff(id, file string, staged bool) (string, error) {
	if err := gitexec.ValidFile(file); err != nil {
		return "", err
	}
	c, err := s.gitCheckout(id)
	if err != nil {
		return "", err
	}
	return s.runner().Diff(s.ctx, c.Path, file, staged)
}
func (s *Service) GitHistory(id string) ([]gitexec.Commit, error) {
	c, err := s.gitCheckout(id)
	if err != nil {
		return nil, err
	}
	return s.runner().History(s.ctx, c.Path)
}
func (s *Service) GitCommitDiff(id, hash string) (string, error) {
	c, err := s.gitCheckout(id)
	if err != nil {
		return "", err
	}
	return s.runner().CommitDiff(s.ctx, c.Path, hash)
}
func (s *Service) GitBranches(id string) ([]gitexec.Branch, error) {
	c, err := s.gitCheckout(id)
	if err != nil {
		return nil, err
	}
	return s.runner().Branches(s.ctx, c.Path)
}
func (s *Service) StageFile(id, file string, stage bool) error {
	c, err := s.gitCheckout(id)
	if err != nil {
		return err
	}
	lock := s.workLock(c.Path)
	if err := lock.Lock(s.ctx); err != nil {
		return err
	}
	defer lock.Unlock()
	if err = s.validateCheckout(c); err != nil {
		return err
	}
	return s.runner().Stage(s.ctx, c.Path, file, stage)
}
func (s *Service) binding(checkoutID, remote string) (model.RepositoryBinding, model.CommitProfile, error) {
	st, err := s.Snapshot()
	if err != nil {
		return model.RepositoryBinding{}, model.CommitProfile{}, err
	}
	return accessBinding(&st, checkoutID, remote)
}
func (s *Service) CommitChanges(id, remote, message string) (string, error) {
	c, err := s.gitCheckout(id)
	if err != nil {
		return "", err
	}
	expectedProfile, err := s.commitIdentity(id, remote)
	if err != nil {
		return "", err
	}
	return s.task("commit", id, func(ctx context.Context, taskID string) error {
		lock := s.workLock(c.Path)
		if err := lock.Lock(ctx); err != nil {
			return err
		}
		defer lock.Unlock()
		if err = s.validateCheckout(c); err != nil {
			return err
		}
		p, err := s.commitIdentity(id, remote)
		if err != nil {
			return err
		}
		if p != expectedProfile {
			return model.Err("BINDING_CHANGED", "排队期间仓库身份已变化，请确认访问账号和提交身份后重新操作")
		}
		return s.runner().Commit(ctx, c.Path, message, p.Name, p.Email)
	})
}
func (s *Service) SwitchBranch(id, name string, create bool) (string, error) {
	c, err := s.gitCheckout(id)
	if err != nil {
		return "", err
	}
	return s.task("branch", id, func(ctx context.Context, _ string) error {
		lock := s.workLock(c.Path)
		if err := lock.Lock(ctx); err != nil {
			return err
		}
		defer lock.Unlock()
		if err = s.validateCheckout(c); err != nil {
			return err
		}
		return s.runner().Switch(ctx, c.Path, name, create)
	})
}
func (s *Service) GitNetwork(id, remote, operation string) (string, error) {
	c, err := s.gitCheckout(id)
	if err != nil {
		return "", err
	}
	if operation != "fetch" && operation != "pull" && operation != "push" {
		return "", model.Err("INVALID_OPERATION", "不支持的 Git 操作")
	}
	expectedBinding, expectedProfile, err := s.binding(id, remote)
	if err != nil {
		return "", err
	}
	return s.task(operation, id, func(ctx context.Context, taskID string) error {
		lock := s.workLock(c.Path)
		if err := lock.Lock(ctx); err != nil {
			return err
		}
		defer lock.Unlock()
		if err = s.validateCheckout(c); err != nil {
			return err
		}
		b, profile, err := s.binding(id, remote)
		if err != nil {
			return err
		}
		if b != expectedBinding || profile != expectedProfile {
			return model.Err("BINDING_CHANGED", "排队期间仓库身份已变化，请确认访问账号和提交身份后重新操作")
		}
		a, err := s.account(b.AccountID)
		if err != nil {
			return err
		}
		al := s.accountLock(accountIdentity(a))
		if err := al.Lock(ctx); err != nil {
			return err
		}
		defer al.Unlock()
		// Reauthorization may have replaced the credential reference while this
		// task waited for the account lock. Resolve the published account again.
		a, err = s.account(b.AccountID)
		if err != nil {
			return err
		}
		token, err := s.vault.Get(a.CredentialRef)
		if err != nil {
			s.markAuthFailure(a.ID, err)
			return err
		}
		helper, err := os.Executable()
		if err != nil {
			return err
		}
		remotes, err := s.runner().Remotes(ctx, c.Path)
		if err != nil {
			return err
		}
		url := ""
		for _, r := range remotes {
			if r.Name == remote {
				url = r.URL
				if operation == "push" {
					url = r.PushURL
				}
			}
		}
		if _, err = gitexec.GitHubTarget(url); err != nil {
			return err
		}
		expected := b.RemoteURL
		if operation == "push" {
			expected = b.PushURL
		}
		target, _ := gitexec.GitHubTarget(url)
		bound, err := gitexec.GitHubTarget(expected)
		if err != nil || target != bound {
			return model.Err("REMOTE_CHANGED", "remote 地址与绑定时不同，请重新确认仓库身份绑定")
		}
		_ = s.updateTask(taskID, func(t *model.Task) { t.Progress = "使用账号 " + a.Login + " 执行 " + operation })
		err = s.progressRunner(taskID).Network(ctx, c.Path, operation, remote, gitexec.Auth{URL: url, Login: a.Login, Token: token, Helper: helper})
		s.markAuthFailure(a.ID, err)
		return err
	})
}
