package service

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"repo-berth/internal/model"
	"repo-berth/internal/provider"
	"repo-berth/internal/store"
)

func TestCancelledBranchDoesNotWaitForRepositoryLock(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	path := t.TempDir()
	if err := s.change(func(st *model.State) error {
		st.Checkouts = append(st.Checkouts, model.LocalCheckout{ID: "checkout", Path: path})
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	lock := s.workLock(path)
	if err := lock.Lock(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer lock.Unlock()
	id, err := s.SwitchBranch("checkout", "should-never-run", true)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.CancelTask(id); err != nil {
		t.Fatal(err)
	}
	// The other operation still owns the lock. Cancellation must finish anyway.
	if task := waitTask(t, s, id); task.State != "cancelled" {
		t.Fatalf("cancelled operation ran or stayed blocked: %+v", task)
	}
}

func TestShutdownIncludesTaskBeingPersisted(t *testing.T) {
	s, _, path := newTestService(t, &fakeProvider{})
	entered, release, returned, closed := make(chan struct{}), make(chan struct{}), make(chan struct{}), make(chan struct{})
	var first sync.Once
	Attach(s, nil, func(string, any) {
		first.Do(func() { close(entered); <-release })
	})
	var ran atomic.Bool
	go func() {
		defer close(returned)
		_, _ = s.task("scan", "registration", func(context.Context, string) error { ran.Store(true); return nil })
	}()
	<-entered
	go func() { Close(s); close(closed) }()
	deadline := time.Now().Add(time.Second)
	for {
		s.mu.Lock()
		closing := s.closing
		s.mu.Unlock()
		if closing {
			break
		}
		if time.Now().After(deadline) {
			close(release)
			t.Fatal("shutdown did not start")
		}
		time.Sleep(time.Millisecond)
	}
	select {
	case <-closed:
		close(release)
		t.Fatal("shutdown closed persistence before registered task finished")
	default:
	}
	close(release)
	select {
	case <-closed:
	case <-time.After(3 * time.Second):
		t.Fatal("shutdown did not finish")
	}
	<-returned
	if ran.Load() {
		t.Fatal("task executed after shutdown started")
	}
	if _, err := s.task("scan", "late", func(context.Context, string) error { return nil }); err == nil {
		t.Fatal("accepted a task after shutdown")
	}
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	state, err := db.Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Tasks) != 1 || state.Tasks[0].State != "cancelled" {
		t.Fatalf("incomplete persisted shutdown: %+v", state.Tasks)
	}
}

func TestAuthorizationsDoNotStarveRepositoryTasks(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	started := make(chan struct{}, 3)
	for i := 0; i < 3; i++ {
		if _, err := s.task("authorize", "browser", func(ctx context.Context, _ string) error {
			started <- struct{}{}
			<-ctx.Done()
			return ctx.Err()
		}); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 3; i++ {
		<-started
	}
	id, err := s.task("scan", "independent-repository", func(context.Context, string) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	if task := waitTask(t, s, id); task.State != "succeeded" {
		t.Fatalf("Git workers starved: %+v", task)
	}
}

func TestTaskPanicIsContainedAndDoesNotExposePayload(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	id, err := s.task("scan", "panic", func(context.Context, string) error { panic("secret provider payload") })
	if err != nil {
		t.Fatal(err)
	}
	if task := waitTask(t, s, id); task.State != "failed" || task.ErrorCode != "INTERNAL" || task.Error == "secret provider payload" {
		t.Fatalf("panic leaked or was not contained: %+v", task)
	}
	second, err := s.task("scan", "next", func(context.Context, string) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	if task := waitTask(t, s, second); task.State != "succeeded" {
		t.Fatalf("worker pool stopped: %+v", task)
	}
}

func TestOperationLockDoesNotAcquireWhenAlreadyCancelled(t *testing.T) {
	l := newOperationLock()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for i := 0; i < 100; i++ {
		if err := l.Lock(ctx); !errors.Is(err, context.Canceled) {
			t.Fatalf("cancelled lock acquired: %v", err)
		}
	}
	if err := l.Lock(context.Background()); err != nil {
		t.Fatal(err)
	}
	l.Unlock()
}

func TestQueuedCommitCannotSilentlyChangeIdentity(t *testing.T) {
	for _, edit := range []string{"profile", "binding"} {
		t.Run(edit, func(t *testing.T) {
			s, _, _ := newTestService(t, &fakeProvider{user: provider.User{ID: 1, Login: "personal"}})
			a := authorize(t, s)
			profile := model.CommitProfile{AccountID: a.ID, Name: "Chosen", Email: "chosen@example.com"}
			id, err := s.SaveProfile(profile)
			if err != nil {
				t.Fatal(err)
			}
			profile.ID = id
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
			run("remote", "add", "origin", "https://github.com/org/project.git")
			if err := os.WriteFile(filepath.Join(dir, "file.txt"), []byte("pending commit"), 0600); err != nil {
				t.Fatal(err)
			}
			run("add", "file.txt")
			checkout, err := s.ImportCheckout(dir)
			if err != nil {
				t.Fatal(err)
			}
			binding := model.RepositoryBinding{CheckoutID: checkout, Remote: "origin", AccountID: a.ID, ProfileID: id}
			if err = s.BindRepository(binding); err != nil {
				t.Fatal(err)
			}
			for i := 0; i < cap(s.sem); i++ {
				s.sem <- struct{}{}
			}
			released := false
			defer func() {
				if !released {
					for i := 0; i < cap(s.sem); i++ {
						<-s.sem
					}
				}
			}()
			task, err := s.CommitChanges(checkout, "origin", "must not silently use a new identity")
			if err != nil {
				t.Fatal(err)
			}
			if edit == "profile" {
				profile.Name = "Changed"
				if _, err = s.SaveProfile(profile); err != nil {
					t.Fatal(err)
				}
			} else {
				profile.ID = ""
				profile.Name = "Other"
				other, err := s.SaveProfile(profile)
				if err != nil {
					t.Fatal(err)
				}
				binding.ProfileID = other
				if err = s.BindRepository(binding); err != nil {
					t.Fatal(err)
				}
			}
			for i := 0; i < cap(s.sem); i++ {
				<-s.sem
			}
			released = true
			if result := waitTask(t, s, task); result.ErrorCode != "BINDING_CHANGED" {
				t.Fatalf("identity changed silently: %+v", result)
			}
			cmd := exec.Command("git", "rev-parse", "--verify", "HEAD")
			cmd.Dir = dir
			if cmd.Run() == nil {
				t.Fatal("unexpected commit created after identity changed")
			}
		})
	}
}
func TestCompletedTaskStaysTerminalWhenPersistenceFails(t *testing.T) {
	s, _, path := newTestService(t, &fakeProvider{})
	started, release := make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	defer releaseOnce.Do(func() { close(release) })
	id, err := s.task("commit", "completed-command", func(context.Context, string) error { close(started); <-release; return nil })
	if err != nil {
		t.Fatal(err)
	}
	<-started
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err = db.Exec(`CREATE TRIGGER reject_task_update BEFORE UPDATE ON tasks BEGIN SELECT RAISE(ABORT,'disk write simulation'); END`); err != nil {
		t.Fatal(err)
	}
	releaseOnce.Do(func() { close(release) })
	result := waitTask(t, s, id)
	if result.State != "succeeded" || result.ErrorCode != "STORAGE_WRITE" {
		t.Fatalf("completed command was misreported: %+v", result)
	}
	if _, err = db.Exec("DROP TRIGGER reject_task_update"); err != nil {
		t.Fatal(err)
	}
}
func TestRestartRecoversOnlyUnfinishedTasksAndSessionAccounts(t *testing.T) {
	p := &fakeProvider{}
	s, _, path := newTestService(t, p)
	if err := s.change(func(st *model.State) error {
		st.Tasks = []model.Task{{ID: "queued", State: "queued"}, {ID: "running", State: "running"}, {ID: "complete", State: "succeeded", FinishedAt: "2026-10-28T12:00:00Z"}}
		st.Accounts = []model.Account{{ID: "session", SessionOnly: true, Status: "connected"}, {ID: "persisted", SessionOnly: false, Status: "connected"}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	Close(s)
	reopened, err := New(path, p, &fakeVault{tokens: map[string]string{}})
	if err != nil {
		t.Fatal(err)
	}
	defer Close(reopened)
	state, err := reopened.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	for _, task := range state.Tasks {
		if task.ID == "complete" {
			if task.State != "succeeded" || task.FinishedAt != "2026-10-28T12:00:00Z" {
				t.Fatal("completed task changed on restart")
			}
		} else if task.State != "interrupted" || task.ErrorCode != "INTERRUPTED" || task.FinishedAt == "" {
			t.Fatalf("unfinished task not recovered: %+v", task)
		}
	}
	if state.Accounts[0].Status != "auth_required" || state.Accounts[1].Status != "connected" {
		t.Fatal("session-only restart state incorrect")
	}
}
