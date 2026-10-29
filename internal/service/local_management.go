package service

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"repo-berth/internal/gitexec"
	"repo-berth/internal/model"
	"sort"
	"strings"
	"time"
)

func (s *Service) gitCheckout(id string) (model.LocalCheckout, error) {
	c, err := s.checkout(id)
	if err == nil && c.PlainDirectory {
		return c, model.Err("NOT_REPOSITORY", "普通目录不能执行 Git 操作，请先重新检测为 Git 仓库")
	}
	return c, err
}

func validateCommitIdentity(name, email string) error {
	if name == "" && email == "" {
		return nil
	}
	if name == "" || !strings.Contains(email, "@") || strings.ContainsAny(name+email, "\r\n\x00<>") {
		return model.Err("INVALID_IDENTITY", "请同时填写有效的提交姓名和邮箱")
	}
	return nil
}

func (s *Service) SetCheckoutIdentity(id, name, email string) error {
	name, email = strings.TrimSpace(name), strings.TrimSpace(email)
	if err := validateCommitIdentity(name, email); err != nil {
		return err
	}
	return s.change(func(st *model.State) error {
		for i := range st.Checkouts {
			if st.Checkouts[i].ID == id {
				st.Checkouts[i].CommitName = name
				st.Checkouts[i].CommitEmail = email
				return nil
			}
		}
		return model.Err("CHECKOUT_MISSING", "本地目录不存在")
	})
}

// The default is resolved at operation time, so editing Settings updates every
// inheriting project. Legacy bindings are used only before a default is set.
func (s *Service) commitIdentity(id, remote string) (model.CommitProfile, error) {
	st, err := s.Snapshot()
	if err != nil {
		return model.CommitProfile{}, err
	}
	for _, c := range st.Checkouts {
		if c.ID == id {
			if c.PlainDirectory {
				return model.CommitProfile{}, model.Err("NOT_REPOSITORY", "普通目录不能执行 Git 操作")
			}
			if c.CommitName != "" {
				return model.CommitProfile{Name: c.CommitName, Email: c.CommitEmail}, nil
			}
			if st.Settings.DefaultCommitName != "" {
				return model.CommitProfile{Name: st.Settings.DefaultCommitName, Email: st.Settings.DefaultCommitEmail}, nil
			}
			_, p, err := s.binding(id, remote)
			if err == nil && p.Name == "" {
				return p, model.Err("IDENTITY_REQUIRED", "请在设置中填写默认提交姓名和邮箱，或为此项目单独指定")
			}
			return p, err
		}
	}
	return model.CommitProfile{}, model.Err("CHECKOUT_MISSING", "本地目录不存在")
}

// Called only after the UI obtains explicit confirmation. It never initializes Git.
func (s *Service) ImportPlainDirectory(path string) (string, error) {
	root, err := gitexec.Canonical(path)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return "", model.Err("INVALID_PATH", "请选择可读取的目录")
	}
	ctx, cancel := context.WithTimeout(s.ctx, 30*time.Second)
	defer cancel()
	if _, err = s.runner().Version(ctx); err != nil {
		return "", err
	}
	if _, err = s.runner().Root(ctx, root); err == nil {
		return "", model.Err("DIRECTORY_IS_REPOSITORY", "此目录属于 Git 仓库，请作为仓库导入")
	}
	var appErr *model.AppError
	if !errors.As(err, &appErr) || appErr.Code != "NOT_REPOSITORY" {
		return "", err
	}
	id := model.ID()
	err = s.change(func(st *model.State) error {
		for _, c := range st.Checkouts {
			if c.Path == root {
				id = c.ID
				return nil
			}
		}
		st.Checkouts = append(st.Checkouts, model.LocalCheckout{ID: id, Path: root, Name: filepath.Base(root), PlainDirectory: true, Remotes: []model.CheckoutRemote{}, LastOpened: model.Now()})
		return nil
	})
	return id, err
}

// One atomic metadata update; no filesystem deletion. Locks are ordered to avoid
// deadlocks, and every target is validated before any record is removed.
func (s *Service) ForgetCheckouts(ids []string) error {
	selected := map[string]bool{}
	paths := map[string]bool{}
	for _, id := range ids {
		c, err := s.checkout(id)
		if err != nil {
			return err
		}
		selected[id] = true
		paths[c.Path] = true
	}
	ordered := []string{}
	for p := range paths {
		ordered = append(ordered, p)
	}
	sort.Strings(ordered)
	for _, path := range ordered {
		lock := s.workLock(path)
		if err := lock.Lock(s.ctx); err != nil {
			return err
		}
		defer lock.Unlock()
	}
	return s.change(func(st *model.State) error {
		for _, task := range st.Tasks {
			if selected[task.Target] && (task.State == "running" || task.State == "queued") {
				return model.Err("CHECKOUT_BUSY", "所选目录仍有任务，请等待完成或取消后重试")
			}
		}
		found := map[string]bool{}
		for _, c := range st.Checkouts {
			found[c.ID] = true
		}
		for id := range selected {
			if !found[id] {
				return model.Err("CHECKOUT_MISSING", "本地目录记录已变化，请刷新后重试")
			}
		}
		checkouts := []model.LocalCheckout{}
		for _, c := range st.Checkouts {
			if !selected[c.ID] {
				checkouts = append(checkouts, c)
			}
		}
		st.Checkouts = checkouts
		bindings := []model.RepositoryBinding{}
		for _, b := range st.Bindings {
			if !selected[b.CheckoutID] {
				bindings = append(bindings, b)
			}
		}
		st.Bindings = bindings
		for i := range st.Groups {
			members := []string{}
			for _, id := range st.Groups[i].Members {
				if !selected[id] {
					members = append(members, id)
				}
			}
			st.Groups[i].Members = members
		}
		return nil
	})
}
