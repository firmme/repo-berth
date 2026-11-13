package service

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"repo-berth/internal/model"
)

// CheckoutHealth describes whether the Git metadata of a managed directory can
// still be read. It is deliberately read-only: callers use it to explain a
// failed status query and, when the metadata is damaged, offer to forget the
// checkout without touching the working tree.
type CheckoutHealth struct {
	State   string `json:"state"`
	Message string `json:"message"`
}

const (
	CheckoutOK             = "ok"
	CheckoutPlain          = "plain_directory"
	CheckoutMissing        = "missing"
	CheckoutCorrupted      = "corrupted"
	CheckoutUnreadable     = "unreadable"
	CheckoutOwnership      = "ownership"
	CheckoutGitUnavailable = "git_unavailable"
	CheckoutConfiguration  = "configuration"
)

func (s *Service) CheckoutHealth(id string) (CheckoutHealth, error) {
	c, err := s.checkout(id)
	if err != nil {
		return CheckoutHealth{}, err
	}
	if c.PlainDirectory {
		return CheckoutHealth{State: CheckoutPlain, Message: "普通目录，不执行 Git 检查"}, nil
	}
	info, err := os.Stat(c.Path)
	if err != nil || !info.IsDir() {
		return CheckoutHealth{State: CheckoutMissing, Message: "本地目录已不存在，可能被移动或删除。"}, nil
	}
	metadata, err := os.Lstat(filepath.Join(c.Path, ".git"))
	if err != nil {
		if os.IsNotExist(err) {
			return CheckoutHealth{State: CheckoutCorrupted, Message: "未找到 .git 目录或文件，仓库可能已损坏或被移动。"}, nil
		}
		return CheckoutHealth{State: CheckoutUnreadable, Message: "无法读取 .git 元数据，请检查目录权限。"}, nil
	}
	if metadata.Mode().IsRegular() {
		// Worktrees and submodules point at their real Git directory through a
		// short .git file; a malformed or missing target is damaged metadata.
		raw, err := os.ReadFile(filepath.Join(c.Path, ".git"))
		if err != nil {
			return CheckoutHealth{State: CheckoutUnreadable, Message: "无法读取 .git 元数据，请检查目录权限。"}, nil
		}
		line := strings.TrimSpace(string(raw))
		if !strings.HasPrefix(strings.ToLower(line), "gitdir:") {
			return CheckoutHealth{State: CheckoutCorrupted, Message: ".git 文件格式无效，仓库元数据可能已损坏。"}, nil
		}
		gitDir := strings.TrimSpace(line[len("gitdir:"):])
		if !filepath.IsAbs(gitDir) {
			gitDir = filepath.Join(c.Path, gitDir)
		}
		if info, err := os.Stat(gitDir); err != nil || !info.IsDir() {
			return CheckoutHealth{State: CheckoutCorrupted, Message: ".git 指向的 Git 目录不存在，仓库元数据可能已损坏。"}, nil
		}
	}

	ctx, cancel := context.WithTimeout(s.ctx, 15*time.Second)
	defer cancel()
	runner := s.runner()
	if _, err := runner.Version(ctx); err != nil {
		return healthFromGitError(err), nil
	}
	if _, err := runner.Root(ctx, c.Path); err != nil {
		return healthFromGitError(err), nil
	}
	// Root only locates the metadata. Status also reads HEAD, refs and the
	// index, which is where most damaged repositories fail.
	if _, err := runner.Status(ctx, c.Path); err != nil {
		return healthFromGitError(err), nil
	}
	return CheckoutHealth{State: CheckoutOK, Message: "仓库可正常读取"}, nil
}

func healthFromGitError(err error) CheckoutHealth {
	if errors.Is(err, context.DeadlineExceeded) {
		return CheckoutHealth{State: CheckoutUnreadable, Message: "读取仓库状态超时，请稍后重试。"}
	}
	if errors.Is(err, context.Canceled) {
		return CheckoutHealth{State: CheckoutUnreadable, Message: "读取仓库状态被取消，请稍后重试。"}
	}
	var appErr *model.AppError
	if !errors.As(err, &appErr) {
		return CheckoutHealth{State: CheckoutUnreadable, Message: "无法读取仓库状态，请稍后重试。"}
	}
	switch appErr.Code {
	case "NOT_REPOSITORY", "GIT_FAILED":
		return CheckoutHealth{State: CheckoutCorrupted, Message: "Git 无法读取 .git 元数据，仓库可能已损坏。"}
	case "DUBIOUS_OWNERSHIP":
		return CheckoutHealth{State: CheckoutOwnership, Message: appErr.Message}
	case "GIT_MISSING", "GIT_INVALID", "GIT_TOO_OLD":
		return CheckoutHealth{State: CheckoutGitUnavailable, Message: appErr.Message}
	case "REMOTE_CREDENTIALS":
		return CheckoutHealth{State: CheckoutConfiguration, Message: appErr.Message}
	case "PERMISSION", "OUTPUT_LIMIT":
		return CheckoutHealth{State: CheckoutUnreadable, Message: appErr.Message}
	default:
		return CheckoutHealth{State: CheckoutUnreadable, Message: appErr.Message}
	}
}
