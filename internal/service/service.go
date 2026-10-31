package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"repo-berth/internal/gitexec"
	"repo-berth/internal/model"
	"repo-berth/internal/provider"
	"repo-berth/internal/store"
	"repo-berth/internal/vault"
	"strings"
	"sync"
	"time"
)

type Desktop interface {
	OpenURL(string) error
	PickDirectory() (string, error)
	OpenPath(string, string, string) error
}
type Service struct {
	mu                    sync.Mutex
	state                 model.State
	store                 *store.Store
	vault                 vault.Vault
	provider              provider.Provider
	ctx                   context.Context
	cancel                context.CancelFunc
	wg                    sync.WaitGroup
	closeOnce             sync.Once
	closing               bool
	closed                bool
	tasks                 map[string]context.CancelFunc
	locks                 map[string]operationLock
	sem                   chan struct{}
	accountLocks          map[string]operationLock
	credentialLock        operationLock
	pendingAuthorizations map[string]*authorizedIdentity
	inflightCredentials   map[string]bool
	desktop               Desktop
	emit                  func(string, any)
	checkUpdates          func()
}

func New(path string, p provider.Provider, v vault.Vault) (*Service, error) {
	db, err := store.Open(path)
	if err != nil {
		return nil, err
	}
	state, err := db.Load()
	if err != nil {
		db.Close()
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	s := &Service{state: state, store: db, provider: p, vault: v, ctx: ctx, cancel: cancel, tasks: map[string]context.CancelFunc{}, locks: map[string]operationLock{}, accountLocks: map[string]operationLock{}, sem: make(chan struct{}, 3), emit: func(string, any) {}}
	s.credentialLock = newOperationLock()
	s.pendingAuthorizations = map[string]*authorizedIdentity{}
	s.inflightCredentials = map[string]bool{}
	for i := range s.state.Tasks {
		t := &s.state.Tasks[i]
		if t.State == "running" || t.State == "queued" {
			t.State = "interrupted"
			t.Error = "应用已退出，请重试该操作"
			t.ErrorCode = "INTERRUPTED"
			t.FinishedAt = model.Now()
		}
	}
	for i := range s.state.Accounts {
		a := &s.state.Accounts[i]
		if a.SessionOnly {
			a.Status = "auth_required"
		}
	}
	normalizeAccountProfiles(&s.state)
	associate(&s.state)
	if err = db.Save(s.state); err != nil {
		cancel()
		db.Close()
		return nil, err
	}
	if len(s.state.CredentialCleanup) > 0 {
		_, _ = s.RetryCredentialCleanup()
	}
	return s, nil
}
func Attach(s *Service, d Desktop, emit func(string, any)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.desktop = d
	s.emit = emit
}
func Close(s *Service) {
	s.closeOnce.Do(func() {
		s.mu.Lock()
		s.closing = true
		s.cancel()
		s.mu.Unlock()
		s.wg.Wait()
		s.mu.Lock()
		s.closed = true
		for taskID := range s.pendingAuthorizations {
			s.discardAuthorizationLocked(taskID)
		}
		s.pendingAuthorizations = map[string]*authorizedIdentity{}
		_ = s.store.Close()
		s.mu.Unlock()
	})
}
func (s *Service) Snapshot() (model.State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, err := json.Marshal(s.state)
	if err != nil {
		return model.State{}, err
	}
	var result model.State
	err = json.Unmarshal(b, &result)
	active := map[string]bool{}
	for _, account := range s.state.Accounts {
		active[account.CredentialRef] = true
	}
	for _, ref := range s.state.CredentialCleanup {
		if !active[ref] && !s.inflightCredentials[ref] {
			result.PendingCredentialCleanupCount++
		}
	}
	result.CredentialCleanup = nil
	result.GitHubAuthConfigured = effectiveGitHubClientID(s.state.Settings.ClientID) != ""
	for id, pending := range s.pendingAuthorizations {
		if !time.Now().Before(pending.expiresAt) {
			s.discardAuthorizationLocked(id)
		}
	}
	for i := range result.Tasks {
		task := &result.Tasks[i]
		if pending, ok := s.pendingAuthorizations[task.ID]; ok && pending.resumeTaskID == "" {
			task.CanResumeAuthorization = true
			task.AuthorizationRecoveryExpiresAt = pending.expiresAt.UTC().Format(time.RFC3339)
		}
	}
	return result, err
}

// change rolls back in-memory state if persistence fails.
func (s *Service) change(fn func(*model.State) error) error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return model.Err("SERVICE_CLOSED", "应用正在退出，请重新启动后操作")
	}
	before, _ := json.Marshal(s.state)
	err := fn(&s.state)
	if err == nil {
		err = s.store.Save(s.state)
	}
	if err != nil {
		var restored model.State
		_ = json.Unmarshal(before, &restored)
		s.state = restored
	}
	emit := s.emit
	s.mu.Unlock()
	if err == nil {
		emit("state:changed", nil)
	}
	return err
}
func (s *Service) runner() gitexec.Runner {
	s.mu.Lock()
	defer s.mu.Unlock()
	paths := []string{}
	for _, c := range s.state.Checkouts {
		if !c.PlainDirectory {
			paths = append(paths, c.Path)
		}
	}
	return gitexec.Runner{Binary: s.state.Settings.GitPath, TrustedDirectories: paths}
}
func accountIdentity(a model.Account) string {
	return fmt.Sprintf("%s:%s:%d", a.Provider, a.Host, a.UserID)
}
func (s *Service) progressRunner(taskID string) gitexec.Runner {
	r := s.runner()
	last := ""
	lastAt := time.Time{}
	r.Progress = func(progress string) {
		if progress == last || time.Since(lastAt) < 500*time.Millisecond {
			return
		}
		last = progress
		lastAt = time.Now()
		_ = s.updateTask(taskID, func(t *model.Task) { t.Progress = progress })
	}
	return r
}
func (s *Service) account(id string) (model.Account, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, a := range s.state.Accounts {
		if a.ID == id {
			return a, nil
		}
	}
	return model.Account{}, model.Err("ACCOUNT_MISSING", "账号已移除，请重新选择")
}
func (s *Service) checkout(id string) (model.LocalCheckout, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, c := range s.state.Checkouts {
		if c.ID == id {
			return c, nil
		}
	}
	return model.LocalCheckout{}, model.Err("CHECKOUT_MISSING", "本地仓库不存在")
}
func (s *Service) validateCheckout(expected model.LocalCheckout) error {
	current, err := s.checkout(expected.ID)
	if err != nil {
		return err
	}
	if current.Path != expected.Path {
		return model.Err("CHECKOUT_CHANGED", "仓库目录已变化，请重新选择本地副本")
	}
	if current.PlainDirectory {
		return model.Err("NOT_REPOSITORY", "普通目录不能执行 Git 操作")
	}
	return nil
}
func (s *Service) workLock(path string) operationLock {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.locks[path] == nil {
		s.locks[path] = newOperationLock()
	}
	return s.locks[path]
}
func (s *Service) accountLock(id string) operationLock {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.accountLocks[id] == nil {
		s.accountLocks[id] = newOperationLock()
	}
	return s.accountLocks[id]
}
func (s *Service) updateTask(id string, fn func(*model.Task)) error {
	var updated model.Task
	err := s.change(func(st *model.State) error {
		for i := range st.Tasks {
			if st.Tasks[i].ID == id {
				before := st.Tasks[i].Progress
				fn(&st.Tasks[i])
				if st.Tasks[i].Progress != "" && st.Tasks[i].Progress != before {
					st.Tasks[i].Logs = append(st.Tasks[i].Logs, model.TaskLog{At: model.Now(), Message: st.Tasks[i].Progress})
					if len(st.Tasks[i].Logs) > 100 {
						st.Tasks[i].Logs = st.Tasks[i].Logs[len(st.Tasks[i].Logs)-100:]
					}
				}
				updated = st.Tasks[i]
				break
			}
		}
		return nil
	})
	if err == nil {
		s.mu.Lock()
		emit := s.emit
		s.mu.Unlock()
		emit("task:updated", updated)
	}
	return err
}
func (s *Service) task(kind, target string, fn func(context.Context, string) error) (string, error) {
	return s.taskWithInitial(kind, target, model.Task{}, fn)
}
func (s *Service) taskWithInitial(kind, target string, initial model.Task, fn func(context.Context, string) error) (string, error) {
	id := model.ID()
	ctx, cancel := context.WithCancel(s.ctx)
	// Registration and shutdown use the same mutex. Once shutdown starts no
	// positive WaitGroup.Add can race its Wait, even while persistence emits events.
	s.mu.Lock()
	if s.closing {
		s.mu.Unlock()
		cancel()
		return "", model.Err("SERVICE_CLOSED", "应用正在退出，请重新启动后操作")
	}
	s.tasks[id] = cancel
	s.wg.Add(1)
	s.mu.Unlock()
	if err := s.change(func(st *model.State) error {
		initial.ID, initial.Kind, initial.Target, initial.State, initial.StartedAt = id, kind, target, "queued", model.Now()
		st.Tasks = append([]model.Task{initial}, st.Tasks...)
		if len(st.Tasks) > 200 {
			kept := make([]model.Task, 0, 200)
			for _, t := range st.Tasks {
				if len(kept) < 200 || t.State == "running" || t.State == "queued" {
					kept = append(kept, t)
				}
			}
			st.Tasks = kept
		}
		return nil
	}); err != nil {
		cancel()
		s.mu.Lock()
		delete(s.tasks, id)
		s.mu.Unlock()
		s.wg.Done()
		return "", err
	}
	go func() {
		defer s.wg.Done()
		defer cancel()
		defer func() {
			s.mu.Lock()
			delete(s.tasks, id)
			for _, pending := range s.pendingAuthorizations {
				if pending.resumeTaskID == id {
					pending.resumeTaskID = ""
				}
			}
			s.mu.Unlock()
		}()
		var result error
		defer func() {
			if recover() != nil {
				result = model.Err("INTERNAL", "任务异常中断，请重试或检查本地配置")
			}
			_ = s.finishTask(id, result)
		}()
		// Waiting for a browser confirmation must not consume all Git worker slots.
		if kind != "authorize" {
			select {
			case s.sem <- struct{}{}:
				defer func() { <-s.sem }()
			case <-ctx.Done():
				result = ctx.Err()
				return
			}
		}
		if result = ctx.Err(); result != nil {
			return
		}
		if result = s.updateTask(id, func(t *model.Task) { t.State = "running"; t.Progress = "正在执行" }); result != nil {
			return
		}
		result = fn(ctx, id)
	}()
	return id, nil
}
func (s *Service) finishTask(id string, err error) error {
	outcome := func(t *model.Task) {
		t.FinishedAt = model.Now()
		if err == nil {
			t.State = "succeeded"
			t.Progress = "已完成"
			return
		}
		t.State = "failed"
		t.Progress = ""
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			t.State = "cancelled"
			t.ErrorCode = "CANCELLED"
			t.Error = "操作已取消或超时"
			return
		}
		var appErr *model.AppError
		if errors.As(err, &appErr) {
			t.ErrorCode = appErr.Code
			t.Error = appErr.Message
		} else {
			t.ErrorCode = "INTERNAL"
			t.Error = "操作失败，请检查目录权限和本地配置"
		}
	}
	if saveErr := s.updateTask(id, outcome); saveErr != nil {
		// A full disk must not leave a completed Git command looking perpetually
		// running, or invite the user to retry a command that actually succeeded.
		s.mu.Lock()
		var updated model.Task
		for i := range s.state.Tasks {
			t := &s.state.Tasks[i]
			if t.ID == id {
				outcome(t)
				if err == nil {
					t.ErrorCode = "STORAGE_WRITE"
					t.Error = "操作已完成，但任务记录未能保存；请检查磁盘空间和目录权限"
				} else {
					t.Error += "；任务记录未能保存，请检查磁盘空间和目录权限"
				}
				updated = *t
				break
			}
		}
		emit := s.emit
		s.mu.Unlock()
		emit("state:changed", nil)
		emit("task:updated", updated)
		return saveErr
	}
	return nil
}
func (s *Service) CancelTask(id string) error {
	s.mu.Lock()
	cancel, ok := s.tasks[id]
	var cancelResume context.CancelFunc
	if pending := s.pendingAuthorizations[id]; pending != nil {
		cancelResume = s.tasks[pending.resumeTaskID]
	}
	s.discardAuthorizationLocked(id)
	s.mu.Unlock()
	if ok {
		cancel()
	}
	if cancelResume != nil {
		cancelResume()
	}
	return nil
}
func (s *Service) GetTasks() ([]model.Task, error) { st, err := s.Snapshot(); return st.Tasks, err }
func (s *Service) SaveSettings(settings model.Settings) error {
	settings.DefaultCommitName = strings.TrimSpace(settings.DefaultCommitName)
	settings.DefaultCommitEmail = strings.TrimSpace(settings.DefaultCommitEmail)
	if err := validateCommitIdentity(settings.DefaultCommitName, settings.DefaultCommitEmail); err != nil {
		return err
	}
	settings.ClientID = strings.TrimSpace(settings.ClientID)
	if settings.GitPath == "" {
		settings.GitPath = "git"
	}
	if strings.ContainsAny(settings.ClientID, " \r\n\t") {
		return model.Err("INVALID_SETTINGS", "Client ID 不能包含空白字符")
	}
	return s.change(func(st *model.State) error {
		settings.DefaultAccountID = st.Settings.DefaultAccountID
		st.Settings = settings
		return nil
	})
}
func (s *Service) GitVersion() (string, error) {
	ctx, cancel := context.WithTimeout(s.ctx, 10*time.Second)
	defer cancel()
	return s.runner().Version(ctx)
}
func (s *Service) PickDirectory() (string, error) {
	s.mu.Lock()
	d := s.desktop
	s.mu.Unlock()
	if d == nil {
		return "", model.Err("DESKTOP_REQUIRED", "请在桌面应用中选择目录")
	}
	return d.PickDirectory()
}
func (s *Service) OpenCheckout(id, kind string) error {
	c, err := s.checkout(id)
	if err != nil {
		return err
	}
	s.mu.Lock()
	d := s.desktop
	editor := s.state.Settings.EditorPath
	s.mu.Unlock()
	if d == nil {
		return model.Err("DESKTOP_REQUIRED", "请在桌面应用中打开目录")
	}
	if kind != "folder" && kind != "terminal" && kind != "editor" && kind != "vscode" {
		return model.Err("INVALID_OPERATION", "不支持的打开方式")
	}
	if err = d.OpenPath(c.Path, kind, editor); err != nil {
		return model.Err("OPEN_FAILED", "无法打开外部工具，请检查设置和安装路径")
	}
	return s.change(func(st *model.State) error {
		for i := range st.Checkouts {
			if st.Checkouts[i].ID == id {
				st.Checkouts[i].LastOpened = model.Now()
			}
		}
		return nil
	})
}
func (s *Service) OpenRepository(id string) error {
	st, err := s.Snapshot()
	if err != nil {
		return err
	}
	for _, r := range st.Repositories {
		if r.ID == id {
			target, err := gitexec.GitHubTarget(r.CloneURL)
			if err != nil {
				return err
			}
			s.mu.Lock()
			d := s.desktop
			s.mu.Unlock()
			if d == nil {
				return model.Err("DESKTOP_REQUIRED", "请在桌面应用中打开网页")
			}
			return d.OpenURL("https://github.com/" + target)
		}
	}
	return model.Err("REPOSITORY_MISSING", "仓库不存在")
}

// OpenCheckoutGitHub opens the selected remote directly, including repositories
// shared locally that have not been added to the synchronized cloud catalogue.
func (s *Service) OpenCheckoutGitHub(id, remote string) error {
	c, err := s.gitCheckout(id)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(s.ctx, 15*time.Second)
	defer cancel()
	remotes, err := s.runner().Remotes(ctx, c.Path)
	if err != nil {
		return err
	}
	target := ""
	for _, r := range remotes {
		if r.Name == remote {
			target = remoteKey(r.URL)
		}
	}
	if target == "" {
		return model.Err("REMOTE_INVALID", "当前 remote 不是 GitHub 仓库")
	}
	s.mu.Lock()
	d := s.desktop
	s.mu.Unlock()
	if d == nil {
		return model.Err("DESKTOP_REQUIRED", "请在桌面应用中打开网页")
	}
	return d.OpenURL("https://github.com/" + target)
}
func (s *Service) OpenGitHubPage(kind string) error {
	urls := map[string]string{"device": "https://github.com/login/device", "settings": "https://github.com/settings/developers", "authorizations": "https://github.com/settings/applications"}
	url, ok := urls[kind]
	if !ok {
		return model.Err("INVALID_OPERATION", "不支持的 GitHub 页面")
	}
	s.mu.Lock()
	desktop := s.desktop
	s.mu.Unlock()
	if desktop == nil {
		return model.Err("DESKTOP_REQUIRED", "请在桌面应用中打开网页")
	}
	return desktop.OpenURL(url)
}
func DatabasePath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "RepoBerth", "berth.db"), nil
}
