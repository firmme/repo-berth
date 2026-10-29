package service

import (
	"errors"
	"os/exec"
	"repo-berth/internal/model"
	"repo-berth/internal/provider"
	"testing"
)

func shareFixture(t *testing.T, remotes map[string]string, commit bool) (*Service, string, string) {
	t.Helper()
	p := &fakeProvider{user: provider.User{ID: 1, Login: "personal"}}
	s, _, _ := newTestService(t, p)
	a := authorize(t, s)
	profile, err := s.SaveProfile(model.CommitProfile{AccountID: a.ID, Name: "Personal", Email: "personal@example.test"})
	if err != nil {
		t.Fatal(err)
	}
	if profile == "" {
		t.Fatal("missing profile")
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
	for name, url := range remotes {
		run("remote", "add", name, url)
	}
	if commit {
		run("-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "--allow-empty", "-m", "init")
	}
	id, err := s.ImportCheckout(dir)
	if err != nil {
		t.Fatal(err)
	}
	return s, id, a.ID
}

func shareError(t *testing.T, s *Service, id, accountID, name, want string) {
	t.Helper()
	taskID, err := s.ShareRepository(id, accountID, name, "", false)
	if err != nil {
		t.Fatal(err)
	}
	task := waitTask(t, s, taskID)
	if task.State != "failed" || task.ErrorCode != want {
		t.Fatalf("task %+v, want %s", task, want)
	}
}

func TestShareRejectsInvalidNameBeforeTask(t *testing.T) {
	s, id, accountID := shareFixture(t, nil, true)
	before, _ := s.Snapshot()
	_, err := s.ShareRepository(id, accountID, "bad name", "", false)
	var appErr *model.AppError
	if !errors.As(err, &appErr) || appErr.Code != "INVALID_NAME" {
		t.Fatalf("error %v", err)
	}
	after, _ := s.Snapshot()
	if len(after.Tasks) != len(before.Tasks) {
		t.Fatalf("invalid name created task: %+v", after.Tasks)
	}
}

func TestShareRejectsExistingOrigin(t *testing.T) {
	s, id, accountID := shareFixture(t, map[string]string{"origin": "https://gitlab.com/team/project.git"}, true)
	shareError(t, s, id, accountID, "shared", "REMOTE_EXISTS")
}

func TestShareRejectsExistingGitHubRemote(t *testing.T) {
	s, id, accountID := shareFixture(t, map[string]string{"upstream": "https://github.com/team/project.git"}, true)
	shareError(t, s, id, accountID, "shared", "ALREADY_SHARED")
}

func TestShareRequiresCommit(t *testing.T) {
	s, id, accountID := shareFixture(t, nil, false)
	shareError(t, s, id, accountID, "shared", "NO_COMMITS")
}
