package service

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"repo-berth/internal/gitexec"
	"repo-berth/internal/model"
)

func cloneRetryFixture(t *testing.T, s *Service) {
	t.Helper()
	if err := s.change(func(st *model.State) error {
		st.Accounts = []model.Account{{ID: "work", Provider: "github", Host: "github.com", UserID: 2, Login: "work", CredentialRef: "missing-test-ref"}}
		st.Profiles = []model.CommitProfile{{ID: "chosen", AccountID: "work", Name: "Work", Email: "work@example.test"}}
		st.Repositories = []model.RemoteRepository{{ID: "repo", CloneURL: "https://github.com/org/private.git"}}
		st.Access = []model.AccountRepository{{ID: "access", AccountID: "work", RepositoryID: "repo"}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestCloneRetryContextSurvivesFailureAndRestart(t *testing.T) {
	s, v, db := newTestService(t, &fakeProvider{})
	cloneRetryFixture(t, s)
	parent, err := gitexec.Canonical(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	dest := filepath.Join(parent, "中文 chosen checkout")
	id, err := s.CloneRepository("repo", "work", "chosen", dest)
	if err != nil {
		t.Fatal(err)
	}
	task := waitTask(t, s, id)
	if task.State != "failed" || task.ErrorCode != "AUTH_REQUIRED" {
		t.Fatalf("unexpected failure: %+v", task)
	}
	Close(s)
	reopened, err := New(db, &fakeProvider{}, v)
	if err != nil {
		t.Fatal(err)
	}
	defer Close(reopened)
	st, err := reopened.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if len(st.Tasks) != 1 {
		t.Fatalf("lost task: %+v", st.Tasks)
	}
	if st.Accounts[0].Status != "auth_required" {
		t.Fatalf("missing credential not reflected in account status: %+v", st.Accounts[0])
	}
	request := st.Tasks[0].CloneRequest
	if request == nil || request.AccountID != "work" || request.ProfileID != "chosen" || request.Destination != dest {
		t.Fatalf("lost original confirmation fields: %+v", request)
	}
	if _, err := os.Stat(dest); !os.IsNotExist(err) {
		t.Fatalf("failed authorization created checkout: %v", err)
	}
}

func TestQueuedCloneRejectsDeletedProfileBeforeNetwork(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	cloneRetryFixture(t, s)
	parent, err := gitexec.Canonical(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	dest := filepath.Join(parent, "queued")
	lock := s.workLock(dest)
	if err := lock.Lock(context.Background()); err != nil {
		t.Fatal(err)
	}
	// Cleanup also releases the lock if task submission fails.
	locked := true
	defer func() {
		if locked {
			lock.Unlock()
		}
	}()
	id, err := s.CloneRepository("repo", "work", "chosen", dest)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteProfile("chosen"); err != nil {
		t.Fatal(err)
	}
	lock.Unlock()
	locked = false
	task := waitTask(t, s, id)
	if task.State != "failed" || task.ErrorCode != "IDENTITY_REQUIRED" {
		t.Fatalf("deleted profile reached credentials or network: %+v", task)
	}
	if _, err := os.Stat(dest); !os.IsNotExist(err) {
		t.Fatalf("invalid identity created checkout: %v", err)
	}
}
