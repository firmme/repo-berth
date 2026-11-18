package service

import (
	"context"
	"strings"
	"time"

	"repo-berth/internal/ghauth"
	"repo-berth/internal/model"
)

type githubCLI interface {
	Accounts(context.Context) ([]ghauth.Account, error)
	Token(context.Context, string) (string, error)
	Login(context.Context, func(string)) error
}

func (s *Service) GitHubCLIAccounts() ([]ghauth.Account, error) {
	ctx, cancel := context.WithTimeout(s.ctx, 30*time.Second)
	defer cancel()
	return s.githubCLI.Accounts(ctx)
}

// ConnectGitHubCLI never switches the CLI's active account to select credentials.
// The explicit username and a provider identity check keep multiple accounts isolated.
func (s *Service) ConnectGitHubCLI(login, replaceID string, browserLogin bool) (string, error) {
	login = strings.TrimSpace(login)
	if !browserLogin && (login == "" || strings.HasPrefix(login, "-") || strings.ContainsAny(login, " \t\r\n\x00")) {
		return "", model.Err("ACCOUNT_MISSING", "请选择要连接的 GitHub CLI 账号")
	}
	if replaceID != "" {
		a, err := s.account(replaceID)
		if err != nil {
			return "", err
		}
		if login != "" && !strings.EqualFold(a.Login, login) {
			return "", model.Err("ACCOUNT_MISMATCH", "请选择原账号的 GitHub CLI 身份")
		}
	}
	return s.task("authorize", replaceID, func(ctx context.Context, taskID string) error {
		ctx, cancel := context.WithTimeout(ctx, 15*time.Minute)
		defer cancel()
		if err := s.cliLock.Lock(ctx); err != nil {
			return err
		}
		defer s.cliLock.Unlock()
		if browserLogin {
			_ = s.updateTask(taskID, func(t *model.Task) { t.Progress = "正在通过官方 GitHub CLI 打开浏览器登录" })
			if err := s.githubCLI.Login(ctx, func(code string) {
				_ = s.updateTask(taskID, func(t *model.Task) { t.Progress = "GitHub 验证码：" + code + "，请在浏览器确认账号" })
			}); err != nil {
				return err
			}
			accounts, err := s.githubCLI.Accounts(ctx)
			if err != nil {
				return err
			}
			login = ""
			for _, a := range accounts {
				if a.Active && a.State == "success" {
					login = a.Login
					break
				}
			}
			if login == "" {
				return model.Err("CLI_AUTH_FAILED", "GitHub CLI 登录后未找到有效账号，请重试")
			}
		}
		token, err := s.githubCLI.Token(ctx, login)
		if err != nil {
			return err
		}
		u, err := s.provider.CurrentUser(ctx, token)
		if err != nil {
			return err
		}
		if !strings.EqualFold(u.Login, login) {
			return model.Err("ACCOUNT_MISMATCH", "GitHub CLI 凭据与所选账号不一致，原凭据未替换")
		}
		return s.saveAuthorization(ctx, taskID, authorizedIdentity{user: u, token: token, authentication: "github-cli", targetAccountID: replaceID, expiresAt: time.Now().Add(10 * time.Minute)}, false)
	})
}
