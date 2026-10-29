package service

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"repo-berth/internal/model"
	"repo-berth/internal/provider"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeVault struct {
	mu     sync.Mutex
	tokens map[string]string
}

func (v *fakeVault) Get(ref string) (string, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	t, ok := v.tokens[ref]
	if !ok {
		return "", model.Err("AUTH_REQUIRED", "missing")
	}
	return t, nil
}
func (v *fakeVault) Set(ref, t string, _ bool) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.tokens[ref] = t
	return nil
}
func (v *fakeVault) Delete(ref string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	delete(v.tokens, ref)
	return nil
}

type fakeProvider struct {
	user  provider.User
	repos []provider.Repository
	poll  func(context.Context) (string, error)
}

func (p *fakeProvider) StartDevice(context.Context, string) (provider.DeviceCode, error) {
	return provider.DeviceCode{DeviceCode: "private-device-code", UserCode: "TEST-CODE", VerificationURI: "https://github.com/login/device", ExpiresIn: 600}, nil
}
func (p *fakeProvider) PollDevice(ctx context.Context, _ string, _ provider.DeviceCode) (string, error) {
	if p.poll != nil {
		return p.poll(ctx)
	}
	return "private-access-token", nil
}
func (p *fakeProvider) CurrentUser(context.Context, string) (provider.User, error) {
	return p.user, nil
}
func (p *fakeProvider) Emails(context.Context, string) ([]provider.Email, error) {
	return []provider.Email{{Email: "verified@example.com", Verified: true}}, nil
}
func (p *fakeProvider) Repositories(context.Context, string) ([]provider.Repository, error) {
	return p.repos, nil
}
func newTestService(t *testing.T, p *fakeProvider) (*Service, *fakeVault, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "berth.db")
	v := &fakeVault{tokens: map[string]string{}}
	s, err := New(path, p, v)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { Close(s) })
	err = s.SaveSettings(model.Settings{ClientID: "test-client", GitPath: "git"})
	if err != nil {
		t.Fatal(err)
	}
	return s, v, path
}
func waitTask(t *testing.T, s *Service, id string) model.Task {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		st, err := s.Snapshot()
		if err != nil {
			t.Fatal(err)
		}
		for _, task := range st.Tasks {
			if task.ID == id && task.State != "running" && task.State != "queued" {
				return task
			}
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("task timed out")
	return model.Task{}
}
func authorize(t *testing.T, s *Service) model.Account {
	t.Helper()
	auth, err := s.StartAuthorization(false, "")
	if err != nil {
		t.Fatal(err)
	}
	task := waitTask(t, s, auth.TaskID)
	if task.State != "succeeded" {
		t.Fatalf("auth: %+v", task)
	}
	st, _ := s.Snapshot()
	return st.Accounts[len(st.Accounts)-1]
}
func TestAuthorizationDeduplicatesAndDoesNotPersistSecrets(t *testing.T) {
	p := &fakeProvider{user: provider.User{ID: 1, Login: "personal", Name: "Personal"}}
	s, v, path := newTestService(t, p)
	a := authorize(t, s)
	authorize(t, s)
	st, _ := s.Snapshot()
	if len(st.Accounts) != 1 {
		t.Fatal("duplicate account")
	}
	b, _ := json.Marshal(st)
	if strings.Contains(string(b), "private-access-token") || strings.Contains(string(b), "private-device-code") {
		t.Fatal("secret in snapshot")
	}
	for _, db := range []string{path, path + "-wal"} {
		b, _ := os.ReadFile(db)
		if strings.Contains(string(b), "private-access-token") {
			t.Fatal("secret in SQLite")
		}
	}
	if len(v.tokens) != 1 {
		t.Fatal("secret not in vault")
	}
	p.user = provider.User{ID: 2, Login: "work"}
	auth, err := s.StartAuthorization(false, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	task := waitTask(t, s, auth.TaskID)
	if task.ErrorCode != "ACCOUNT_MISMATCH" {
		t.Fatalf("reauth mismatch %+v", task)
	}
	st, _ = s.Snapshot()
	if st.Accounts[0].UserID != 1 {
		t.Fatal("reauth changed account")
	}
}
func TestSharedRepositoriesAndRemovePreservesCheckouts(t *testing.T) {
	repo := provider.Repository{ID: 42, Name: "shared", CloneURL: "https://github.com/org/shared.git"}
	repo.Owner.Login = "org"
	p := &fakeProvider{user: provider.User{ID: 1, Login: "personal"}, repos: []provider.Repository{repo}}
	s, v, _ := newTestService(t, p)
	a := authorize(t, s)
	id, _ := s.SyncRepositories(a.ID)
	if task := waitTask(t, s, id); task.State != "succeeded" {
		t.Fatalf("sync %+v", task)
	}
	p.user = provider.User{ID: 2, Login: "work"}
	b := authorize(t, s)
	id, _ = s.SyncRepositories(b.ID)
	waitTask(t, s, id)
	st, _ := s.Snapshot()
	if len(st.Repositories) != 1 || len(st.Access) != 2 {
		t.Fatal("repository access not deduplicated")
	}
	profile, err := s.SaveProfile(model.CommitProfile{AccountID: a.ID, Name: "Personal", Email: "personal@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(t.TempDir(), "中文 existing")
	_ = os.MkdirAll(dir, 0700)
	for _, args := range [][]string{{"init", "-b", "main"}, {"remote", "add", "origin", repo.CloneURL}} {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("setup %v %s", err, out)
		}
	}
	checkoutID, err := s.ImportCheckout(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.BindRepository(model.RepositoryBinding{CheckoutID: checkoutID, Remote: "origin", AccountID: a.ID, ProfileID: profile}); err != nil {
		t.Fatal(err)
	}
	if err = s.RemoveAccount(a.ID); err != nil {
		t.Fatal(err)
	}
	st, _ = s.Snapshot()
	if len(st.Checkouts) != 1 || st.Bindings[0].AccountID != "" || len(st.Access) != 1 {
		t.Fatal("account removal lost data or left binding")
	}
	if _, err = os.Stat(dir); err != nil {
		t.Fatal("checkout removed")
	}
	if _, ok := v.tokens[a.CredentialRef]; ok {
		t.Fatal("credential retained")
	}
}
func TestAuthorizationCancellationAndTaskRecovery(t *testing.T) {
	p := &fakeProvider{poll: func(ctx context.Context) (string, error) { <-ctx.Done(); return "", ctx.Err() }}
	s, _, _ := newTestService(t, p)
	auth, err := s.StartAuthorization(false, "")
	if err != nil {
		t.Fatal(err)
	}
	_ = s.CancelTask(auth.TaskID)
	if task := waitTask(t, s, auth.TaskID); task.State != "cancelled" {
		t.Fatalf("cancel %+v", task)
	}
	_ = s.change(func(st *model.State) error {
		st.Tasks = append(st.Tasks, model.Task{ID: "interrupted", State: "running"})
		return nil
	})
	state, _ := s.store.Load()
	if state.Tasks[len(state.Tasks)-1].ID != "interrupted" {
		t.Fatal("tasks not persisted")
	}
}
func TestStoreRollbackOnValidationFailure(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	_ = s.change(func(st *model.State) error {
		st.Groups = append(st.Groups, model.Group{ID: "should-rollback"})
		return model.Err("TEST", "fail")
	})
	st, _ := s.Snapshot()
	if len(st.Groups) != 0 {
		t.Fatal("failed transaction mutated memory")
	}
}
func TestRemoteChangesRequireRebinding(t *testing.T) {
	p := &fakeProvider{user: provider.User{ID: 1, Login: "personal"}}
	s, _, _ := newTestService(t, p)
	a := authorize(t, s)
	profile, err := s.SaveProfile(model.CommitProfile{AccountID: a.ID, Name: "Personal", Email: "personal@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
	}
	run("init", "-b", "main")
	run("remote", "add", "origin", "https://github.com/org/first.git")
	id, err := s.ImportCheckout(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.BindRepository(model.RepositoryBinding{CheckoutID: id, Remote: "origin", AccountID: a.ID, ProfileID: profile}); err != nil {
		t.Fatal(err)
	}
	run("remote", "set-url", "origin", "https://github.com/org/other.git")
	taskID, err := s.GitNetwork(id, "origin", "fetch")
	if err != nil {
		t.Fatal(err)
	}
	if task := waitTask(t, s, taskID); task.ErrorCode != "REMOTE_CHANGED" {
		t.Fatalf("did not block remote change: %+v", task)
	}
}
