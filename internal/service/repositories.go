package service

import (
	"context"
	"errors"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"repo-berth/internal/gitexec"
	"repo-berth/internal/model"
	"sort"
	"strings"
	"time"
)

func remoteKey(raw string) string {
	if strings.HasPrefix(raw, "git@github.com:") {
		raw = "https://github.com/" + strings.TrimPrefix(raw, "git@github.com:")
	}
	if strings.HasPrefix(raw, "ssh://git@github.com/") {
		raw = "https://github.com/" + strings.TrimPrefix(raw, "ssh://git@github.com/")
	}
	key, _ := gitexec.GitHubTarget(raw)
	return key
}
func associate(st *model.State) {
	for i := range st.Checkouts {
		c := &st.Checkouts[i]
		if c.RepositoryID == "" {
			remotes := append([]model.CheckoutRemote(nil), c.Remotes...)
			sort.SliceStable(remotes, func(i, j int) bool { return remotes[i].Name == "origin" && remotes[j].Name != "origin" })
			for _, remote := range remotes {
				key := remoteKey(remote.URL)
				if key == "" {
					continue
				}
				for _, r := range st.Repositories {
					if remoteKey(r.CloneURL) == key {
						c.RepositoryID = r.ID
						break
					}
				}
				if c.RepositoryID != "" {
					break
				}
			}
		}
		// The merged row owns organization metadata. Transfer it once, so a
		// later unfavorite or group edit is not undone by another import/sync.
		for j := range st.Repositories {
			r := &st.Repositories[j]
			if r.ID != c.RepositoryID {
				continue
			}
			r.Favorite = r.Favorite || c.Favorite
			c.Favorite = false
			if c.LastOpened > r.LastOpened {
				r.LastOpened = c.LastOpened
			}
			break
		}
	}
	for i := range st.Groups {
		st.Groups[i].Members = canonicalGroupMembers(st, st.Groups[i].Members)
	}
	associateAccounts(st)
}

func canonicalGroupMembers(st *model.State, members []string) []string {
	aliases := map[string]string{}
	repositories := map[string]bool{}
	for _, r := range st.Repositories {
		repositories[r.ID] = true
	}
	for _, c := range st.Checkouts {
		if repositories[c.RepositoryID] {
			aliases[c.ID] = c.RepositoryID
		}
	}
	result := []string{}
	seen := map[string]bool{}
	for _, member := range members {
		if target := aliases[member]; target != "" {
			member = target
		}
		if member != "" && !seen[member] {
			result = append(result, member)
			seen[member] = true
		}
	}
	return result
}
func safeRemote(raw string) string {
	u, err := url.Parse(raw)
	if err == nil && u.Scheme != "" {
		u.User = nil
		u.RawQuery = ""
		u.Fragment = ""
		return u.String()
	}
	if strings.HasPrefix(raw, "git@github.com:") {
		return raw
	}
	return ""
}
func (s *Service) importPath(ctx context.Context, path string) (string, error) {
	runner := s.repositoryRunner(path)
	root, err := runner.Root(ctx, path)
	if err != nil {
		return "", err
	}
	root, err = gitexec.Canonical(root)
	if err != nil {
		return "", err
	}
	remotes, err := runner.Remotes(ctx, root)
	if err != nil {
		return "", err
	}
	rs := []model.CheckoutRemote{}
	for _, r := range remotes {
		rs = append(rs, model.CheckoutRemote{Name: r.Name, URL: safeRemote(r.URL), PushURL: safeRemote(r.PushURL)})
	}
	id := model.ID()
	err = s.change(func(st *model.State) error {
		for i := range st.Checkouts {
			if st.Checkouts[i].Path == root {
				id = st.Checkouts[i].ID
				st.Checkouts[i].Remotes = rs
				st.Checkouts[i].PlainDirectory = false
				st.Checkouts[i].RepositoryID = ""
				associate(st)
				return nil
			}
		}
		st.Checkouts = append(st.Checkouts, model.LocalCheckout{ID: id, Path: root, Name: filepath.Base(root), Remotes: rs, LastOpened: model.Now()})
		associate(st)
		return nil
	})
	if err != nil {
		return "", model.Err("STORAGE_WRITE", "本地仓库记录无法保存，请检查磁盘空间与目录权限；仓库文件未被修改")
	}
	return id, err
}
func (s *Service) ImportCheckout(path string) (string, error) {
	ctx, cancel := context.WithTimeout(s.ctx, 30*time.Second)
	defer cancel()
	return s.importPath(ctx, path)
}
func (s *Service) ScanDirectory(path string) (string, error) {
	root, err := gitexec.Canonical(path)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return "", model.Err("INVALID_PATH", "请选择可读取的扫描目录")
	}
	return s.taskWithInitial("scan", root, model.Task{ScanSummary: &model.ScanSummary{Issues: []model.ScanIssue{}}}, func(ctx context.Context, taskID string) error {
		if _, err := s.runner().Version(ctx); err != nil {
			return err
		}
		summary := model.ScanSummary{Issues: []model.ScanIssue{}}
		publish := func() error {
			copy := summary
			copy.Issues = append([]model.ScanIssue{}, summary.Issues...)
			if err := s.updateTask(taskID, func(t *model.Task) {
				t.ScanSummary = &copy
				t.Progress = "导入/更新 " + intString(summary.Imported) + " 个副本，跳过 " + intString(summary.Skipped) + " 项"
			}); err != nil {
				return model.Err("STORAGE_WRITE", "扫描结果无法保存，请检查磁盘空间和目录权限；已导入记录仍保留")
			}
			return nil
		}
		skip := func(path, code string) error {
			summary.Skipped++
			if len(summary.Issues) < 20 {
				relative, _ := filepath.Rel(root, path)
				summary.Issues = append(summary.Issues, model.ScanIssue{Path: relative, Code: code})
			}
			return publish()
		}
		visited := 0
		err := filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
			if err := ctx.Err(); err != nil {
				return err
			}
			if walkErr != nil {
				if path == root {
					return model.Err("INVALID_PATH", "无法读取扫描目录")
				}
				if err := skip(path, "UNREADABLE"); err != nil {
					return err
				}
				if d != nil && d.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			visited++
			if visited > 100000 {
				return model.Err("SCAN_LIMIT", "扫描目录过大，请选择更小的目录")
			}
			if !d.IsDir() {
				return nil
			}
			relative, _ := filepath.Rel(root, path)
			if path != root && strings.Count(relative, string(filepath.Separator))+1 > 2 {
				return filepath.SkipDir
			}
			if path != root && (d.Name() == "node_modules" || d.Name() == ".git" || d.Name() == "vendor" || d.Name() == ".cache") {
				return filepath.SkipDir
			}
			if _, err := os.Stat(filepath.Join(path, ".git")); err == nil {
				if _, err = s.importPath(ctx, path); err != nil {
					if ctx.Err() != nil {
						return ctx.Err()
					}
					var appErr *model.AppError
					if !errors.As(err, &appErr) {
						return err
					}
					switch appErr.Code {
					case "NOT_REPOSITORY", "REMOTE_CREDENTIALS", "PERMISSION", "GIT_FAILED", "DUBIOUS_OWNERSHIP":
						if err := skip(path, appErr.Code); err != nil {
							return err
						}
						return filepath.SkipDir
					default:
						return err
					}
				}
				summary.Imported++
				if err := publish(); err != nil {
					return err
				}
				return filepath.SkipDir
			} else if !os.IsNotExist(err) {
				if err := skip(path, "UNREADABLE"); err != nil {
					return err
				}
				return filepath.SkipDir
			}
			return nil
		})
		if err != nil {
			return err
		}
		if summary.Skipped > 0 {
			return model.Err("SCAN_PARTIAL", "扫描完成，部分目录无法导入；已导入的副本已保留，请在任务中查看跳过项")
		}
		return nil
	})
}
func intString(v int) string {
	if v == 0 {
		return "0"
	}
	s := ""
	for v > 0 {
		s = string(rune('0'+v%10)) + s
		v /= 10
	}
	return s
}
func (s *Service) BindRepository(binding model.RepositoryBinding) error {
	c, err := s.checkout(binding.CheckoutID)
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
	if _, err = s.account(binding.AccountID); err != nil {
		return err
	}
	remotes, err := s.runner().Remotes(s.ctx, c.Path)
	if err != nil {
		return err
	}
	exists := false
	for _, r := range remotes {
		if r.Name == binding.Remote {
			exists = true
			binding.RemoteURL = r.URL
			binding.PushURL = r.PushURL
		}
	}
	if !exists {
		return model.Err("REMOTE_INVALID", "请选择存在的 remote")
	}
	return s.change(func(st *model.State) error {
		accountExists := false
		for _, account := range st.Accounts {
			if account.ID == binding.AccountID {
				accountExists = true
				break
			}
		}
		if !accountExists {
			return model.Err("ACCOUNT_MISSING", "账号已移除，请重新选择")
		}
		found := false
		for _, p := range st.Profiles {
			if p.ID == binding.ProfileID && p.AccountID == binding.AccountID {
				found = true
			}
		}
		if !found {
			return model.Err("IDENTITY_REQUIRED", "请先为所选账号保存提交身份")
		}
		binding.ID = binding.CheckoutID + ":" + binding.Remote
		for i := range st.Bindings {
			if st.Bindings[i].ID == binding.ID {
				st.Bindings[i] = binding
				return nil
			}
		}
		st.Bindings = append(st.Bindings, binding)
		return nil
	})
}
func (s *Service) CloneRepository(repoID, accountID, profileID, dest string) (string, error) {
	st, err := s.Snapshot()
	if err != nil {
		return "", err
	}
	var repo model.RemoteRepository
	for _, r := range st.Repositories {
		if r.ID == repoID {
			repo = r
		}
	}
	if repo.ID == "" {
		return "", model.Err("REPOSITORY_MISSING", "请选择仓库")
	}
	allowed := false
	for _, a := range st.Access {
		if a.AccountID == accountID && a.RepositoryID == repoID {
			allowed = true
		}
	}
	if !allowed {
		return "", model.Err("PERMISSION", "所选账号没有该仓库的访问记录，请先同步")
	}
	return s.cloneRepository(repoID, repo.CloneURL, accountID, profileID, dest, false)
}

// CloneFromURL accepts an explicit GitHub HTTPS repository address, including
// repositories that have not been synchronized into the account catalogue.
func (s *Service) CloneFromURL(raw, accountID, profileID, dest string) (string, error) {
	key, err := gitexec.GitHubTarget(strings.TrimSpace(raw))
	if err != nil {
		return "", err
	}
	url := "https://github.com/" + key + ".git"
	return s.cloneRepository("", url, accountID, profileID, dest, true)
}

func (s *Service) cloneRepository(repoID, cloneURL, accountID, profileID, dest string, direct bool) (string, error) {
	st, err := s.Snapshot()
	if err != nil {
		return "", err
	}
	valid := direct && accountID == "" && profileID == ""
	for _, p := range st.Profiles {
		if p.ID == profileID && p.AccountID == accountID {
			valid = true
		}
	}
	if !valid {
		return "", model.Err("IDENTITY_REQUIRED", "请先保存并选择该账号的提交身份")
	}
	var a model.Account
	if accountID != "" {
		a, err = s.account(accountID)
		if err != nil {
			return "", err
		}
	}
	parent, err := gitexec.Canonical(filepath.Dir(dest))
	if err != nil {
		return "", err
	}
	name := filepath.Base(dest)
	if name == "." || name == ".." || name == string(filepath.Separator) {
		return "", model.Err("INVALID_PATH", "请选择新的克隆目录")
	}
	dest = filepath.Join(parent, name)
	request := &model.CloneRequest{AccountID: accountID, ProfileID: profileID, Destination: dest}
	target := repoID
	if direct {
		request.URL = cloneURL
		target = cloneURL
	}
	return s.taskWithInitial("clone", target, model.Task{CloneRequest: request}, func(ctx context.Context, taskID string) error {
		lock := s.workLock(dest)
		if err := lock.Lock(ctx); err != nil {
			return err
		}
		defer lock.Unlock()
		if accountID != "" {
			accountLock := s.accountLock(accountIdentity(a))
			if err := accountLock.Lock(ctx); err != nil {
				return err
			}
			defer accountLock.Unlock()
		}
		// A profile can be removed while this task is waiting for a worker or
		// repository lock. Never create a binding to a vanished identity.
		var auth gitexec.Auth
		if accountID != "" {
			if err := s.validateCloneProfile(accountID, profileID); err != nil {
				return err
			}
			a, err := s.account(accountID)
			if err != nil {
				return err
			}
			token, err := s.vault.Get(a.CredentialRef)
			if err != nil {
				s.markAuthFailure(accountID, err)
				return err
			}
			helper, err := os.Executable()
			if err != nil {
				return err
			}
			auth = gitexec.Auth{URL: cloneURL, Login: a.Login, Token: token, Helper: helper}
			_ = s.updateTask(taskID, func(t *model.Task) { t.Progress = "正在克隆，使用账号 " + a.Login })
		} else {
			_ = s.updateTask(taskID, func(t *model.Task) { t.Progress = "正在克隆公开仓库" })
		}
		if err = s.progressRunner(taskID).Clone(ctx, cloneURL, dest, auth); err != nil {
			if accountID != "" {
				s.markAuthFailure(accountID, err)
			}
			return err
		}
		id, err := s.importPath(ctx, dest)
		if err != nil {
			return err
		}
		if accountID == "" {
			return nil
		}
		return s.change(func(st *model.State) error {
			found := false
			for _, p := range st.Profiles {
				if p.ID == profileID && p.AccountID == accountID {
					found = true
					break
				}
			}
			if !found {
				return model.Err("IDENTITY_REQUIRED", "克隆文件已保留，但提交身份已移除；请导入目录并重新绑定身份")
			}
			for i := range st.Checkouts {
				if st.Checkouts[i].ID == id && repoID != "" {
					st.Checkouts[i].RepositoryID = repoID
				}
			}
			st.Bindings = append(st.Bindings, model.RepositoryBinding{ID: id + ":origin", CheckoutID: id, Remote: "origin", AccountID: accountID, ProfileID: profileID, RemoteURL: cloneURL, PushURL: cloneURL})
			return nil
		})
	})
}

func (s *Service) validateCloneProfile(accountID, profileID string) error {
	st, err := s.Snapshot()
	if err != nil {
		return err
	}
	for _, p := range st.Profiles {
		if p.ID == profileID && p.AccountID == accountID {
			return nil
		}
	}
	return model.Err("IDENTITY_REQUIRED", "排队期间提交身份已移除，请重新确认克隆账号和提交身份")
}

// ForgetCheckout removes only application metadata, never repository files.
func (s *Service) ForgetCheckout(id string) error {
	return s.ForgetCheckouts([]string{id})
}
func (s *Service) MarkVisited(id string) error {
	return s.change(func(st *model.State) error {
		for i := range st.Repositories {
			if st.Repositories[i].ID == id {
				st.Repositories[i].LastOpened = model.Now()
				return nil
			}
		}
		for i := range st.Checkouts {
			if st.Checkouts[i].ID == id {
				st.Checkouts[i].LastOpened = model.Now()
				return nil
			}
		}
		return model.Err("REPOSITORY_MISSING", "仓库不存在")
	})
}
func (s *Service) ToggleFavorite(id string) error {
	return s.change(func(st *model.State) error {
		for _, c := range st.Checkouts {
			if c.ID == id {
				for _, r := range st.Repositories {
					if r.ID == c.RepositoryID {
						id = r.ID
						break
					}
				}
				break
			}
		}
		for i := range st.Repositories {
			if st.Repositories[i].ID == id {
				st.Repositories[i].Favorite = !st.Repositories[i].Favorite
				return nil
			}
		}
		for i := range st.Checkouts {
			if st.Checkouts[i].ID == id {
				st.Checkouts[i].Favorite = !st.Checkouts[i].Favorite
				return nil
			}
		}
		return model.Err("REPOSITORY_MISSING", "仓库不存在")
	})
}
func (s *Service) SaveGroup(group model.Group) (string, error) {
	group.Name = strings.TrimSpace(group.Name)
	if group.Name == "" {
		return "", model.Err("INVALID_GROUP", "请输入分组名称")
	}
	if group.ID == "" {
		group.ID = model.ID()
	}
	if group.Members == nil {
		group.Members = []string{}
	}
	err := s.change(func(st *model.State) error {
		group.Members = canonicalGroupMembers(st, group.Members)
		for i := range st.Groups {
			if st.Groups[i].ID == group.ID {
				st.Groups[i] = group
				return nil
			}
		}
		st.Groups = append(st.Groups, group)
		return nil
	})
	return group.ID, err
}
func (s *Service) DeleteGroup(id string) error {
	return s.change(func(st *model.State) error {
		groups := []model.Group{}
		for _, g := range st.Groups {
			if g.ID != id {
				groups = append(groups, g)
			}
		}
		st.Groups = groups
		return nil
	})
}
func (s *Service) ConvertRemoteHTTPS(checkoutID, remote string) error {
	c, err := s.checkout(checkoutID)
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
	remotes, err := s.runner().Remotes(s.ctx, c.Path)
	if err != nil {
		return err
	}
	for _, r := range remotes {
		if r.Name == remote {
			key := remoteKey(r.URL)
			if key == "" {
				return model.Err("REMOTE_INVALID", "只支持转换 GitHub SSH 地址")
			}
			if r.URL != r.PushURL {
				return model.Err("REMOTE_INVALID", "remote 存在独立 push URL，请在外部工具中分别调整")
			}
			if _, err = s.runner().Run(s.ctx, c.Path, nil, nil, "remote", "set-url", remote, "https://github.com/"+key+".git"); err != nil {
				return err
			}
			_, err = s.importPath(s.ctx, c.Path)
			return err
		}
	}
	return model.Err("REMOTE_INVALID", "远程仓库不存在")
}
