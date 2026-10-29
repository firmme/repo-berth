package service

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"repo-berth/internal/model"
	"repo-berth/internal/provider"
)

func importTestRepository(t *testing.T, s *Service) (string, string) {
	t.Helper()
	dir := t.TempDir()
	for _, args := range [][]string{{"init", "-b", "main"}, {"remote", "add", "origin", "https://github.com/org/project.git"}} {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "uncommitted.txt"), []byte("precious local work"), 0600); err != nil {
		t.Fatal(err)
	}
	id, err := s.ImportCheckout(dir)
	if err != nil {
		t.Fatal(err)
	}
	return id, dir
}

func TestForgetCheckoutPreservesFilesAndRemovesOnlyMetadata(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{user: provider.User{ID: 1, Login: "personal"}})
	a := authorize(t, s)
	id, dir := importTestRepository(t, s)
	profile, err := s.SaveProfile(model.CommitProfile{AccountID: a.ID, Name: "Personal", Email: "personal@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.BindRepository(model.RepositoryBinding{CheckoutID: id, Remote: "origin", AccountID: a.ID, ProfileID: profile}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.SaveGroup(model.Group{Name: "Work", Members: []string{id, "cloud-record"}}); err != nil {
		t.Fatal(err)
	}
	if err = s.DeleteProfile(profile); err == nil || !strings.HasPrefix(err.Error(), "PROFILE_IN_USE:") {
		t.Fatalf("deleted identity still used by repository: %v", err)
	}
	headBefore, _ := os.ReadFile(filepath.Join(dir, ".git", "HEAD"))
	if err = s.ForgetCheckout(id); err != nil {
		t.Fatal(err)
	}
	state, _ := s.Snapshot()
	if len(state.Checkouts) != 0 || len(state.Bindings) != 0 {
		t.Fatal("checkout metadata or binding survived forget")
	}
	if len(state.Groups[0].Members) != 1 || state.Groups[0].Members[0] != "cloud-record" {
		t.Fatal("forget changed unrelated group members")
	}
	headAfter, err := os.ReadFile(filepath.Join(dir, ".git", "HEAD"))
	if err != nil || string(headBefore) != string(headAfter) {
		t.Fatal("Git directory was modified")
	}
	file, err := os.ReadFile(filepath.Join(dir, "uncommitted.txt"))
	if err != nil || string(file) != "precious local work" {
		t.Fatal("forget modified local work")
	}
	if err = s.DeleteProfile(profile); err != nil {
		t.Fatalf("could not delete unbound identity: %v", err)
	}
	next, err := s.ImportCheckout(dir)
	if err != nil || next == id {
		t.Fatal("forgotten repository could not be imported afresh")
	}
	state, _ = s.Snapshot()
	if len(state.Bindings) != 0 {
		t.Fatal("reimport silently restored forgotten credentials")
	}
}

func TestForgetCheckoutRequiresQueuedTasksToBeCancelled(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	id, _ := importTestRepository(t, s)
	for i := 0; i < cap(s.sem); i++ {
		s.sem <- struct{}{}
	}
	defer func() {
		for i := 0; i < cap(s.sem); i++ {
			<-s.sem
		}
	}()
	task, err := s.SwitchBranch(id, "queued", true)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.ForgetCheckout(id); err == nil || !strings.HasPrefix(err.Error(), "CHECKOUT_BUSY:") {
		t.Fatalf("forgot a repository with queued writes: %v", err)
	}
	if err = s.CancelTask(task); err != nil {
		t.Fatal(err)
	}
	if result := waitTask(t, s, task); result.State != "cancelled" {
		t.Fatalf("queued branch did not cancel: %+v", result)
	}
	if err = s.ForgetCheckout(id); err != nil {
		t.Fatal(err)
	}
}

func TestShutdownWhileWaitingForAccountLockFinishes(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{user: provider.User{ID: 1, Login: "personal"}})
	a := authorize(t, s)
	lock := s.accountLock(accountIdentity(a))
	if err := lock.Lock(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer lock.Unlock()
	_, err := s.SyncRepositories(a.ID)
	if err != nil {
		t.Fatal(err)
	}
	// The task must not hold shutdown hostage while waiting for this account.
	done := make(chan struct{})
	go func() { Close(s); close(done) }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("shutdown waited for an unrelated account lock")
	}
}
