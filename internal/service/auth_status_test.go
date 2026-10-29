package service

import (
	"context"
	"os/exec"
	"repo-berth/internal/model"
	"runtime"
	"strings"
	"testing"
	"time"
)

type credentialReferenceProbe struct{ requested chan string }

func (v *credentialReferenceProbe) Get(ref string) (string, error) {
	v.requested <- ref
	return "", model.Err("VAULT_UNAVAILABLE", "synthetic stop before transport")
}
func (*credentialReferenceProbe) Set(string, string, bool) error { return nil }
func (*credentialReferenceProbe) Delete(string) error            { return nil }

func TestNetworkReloadsPublishedCredentialAfterAccountLockWait(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	cloneRetryFixture(t, s)
	path := t.TempDir()
	for _, args := range [][]string{{"init", "-b", "main"}, {"remote", "add", "origin", "https://github.com/org/private.git"}} {
		cmd := exec.Command("git", args...)
		cmd.Dir = path
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("fixture %v %s", err, out)
		}
	}
	checkout, err := s.ImportCheckout(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.BindRepository(model.RepositoryBinding{CheckoutID: checkout, Remote: "origin", AccountID: "work", ProfileID: "chosen"}); err != nil {
		t.Fatal(err)
	}
	probe := &credentialReferenceProbe{requested: make(chan string, 1)}
	s.vault = probe
	account, err := s.account("work")
	if err != nil {
		t.Fatal(err)
	}
	lock := s.accountLock(accountIdentity(account))
	if err = lock.Lock(context.Background()); err != nil {
		t.Fatal(err)
	}
	locked := true
	defer func() {
		if locked {
			lock.Unlock()
		}
	}()
	id, err := s.GitNetwork(checkout, "origin", "fetch")
	if err != nil {
		t.Fatal(err)
	}
	// Observe the task actually waiting at its account lock, rather than using
	// a timing delay that could rotate the reference before it was captured.
	deadline := time.Now().Add(5 * time.Second)
	for {
		buf := make([]byte, 1<<20)
		n := runtime.Stack(buf, true)
		waiting := false
		for _, stack := range strings.Split(string(buf[:n]), "\n\n") {
			if strings.Contains(stack, ".GitNetwork.func1(") && strings.Contains(stack, "operationLock.Lock(") {
				waiting = true
				break
			}
		}
		if waiting {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("network task never reached the held account lock")
		}
		time.Sleep(time.Millisecond)
	}
	if err = s.change(func(st *model.State) error { st.Accounts[0].CredentialRef = "newly-published-ref"; return nil }); err != nil {
		t.Fatal(err)
	}
	lock.Unlock()
	locked = false
	task := waitTask(t, s, id)
	if task.ErrorCode != "VAULT_UNAVAILABLE" {
		t.Fatalf("probe did not stop before transport: %+v", task)
	}
	select {
	case ref := <-probe.requested:
		if ref != "newly-published-ref" {
			t.Fatalf("read obsolete credential reference %q", ref)
		}
	default:
		t.Fatal("credential reference not resolved")
	}
}

func TestMissingCredentialMarksSyncAndGitAccountForReauthorization(t *testing.T) {
	for _, operation := range []string{"sync", "fetch"} {
		t.Run(operation, func(t *testing.T) {
			s, _, _ := newTestService(t, &fakeProvider{})
			cloneRetryFixture(t, s)
			var id string
			var err error
			if operation == "sync" {
				id, err = s.SyncRepositories("work")
			} else {
				path := t.TempDir()
				for _, args := range [][]string{{"init", "-b", "main"}, {"remote", "add", "origin", "https://github.com/org/private.git"}} {
					cmd := exec.Command("git", args...)
					cmd.Dir = path
					if output, e := cmd.CombinedOutput(); e != nil {
						t.Fatalf("fixture: %v %s", e, output)
					}
				}
				checkout, e := s.ImportCheckout(path)
				if e != nil {
					t.Fatal(e)
				}
				if e = s.BindRepository(model.RepositoryBinding{CheckoutID: checkout, Remote: "origin", AccountID: "work", ProfileID: "chosen"}); e != nil {
					t.Fatal(e)
				}
				id, err = s.GitNetwork(checkout, "origin", "fetch")
			}
			if err != nil {
				t.Fatal(err)
			}
			task := waitTask(t, s, id)
			if task.State != "failed" || task.ErrorCode != "AUTH_REQUIRED" {
				t.Fatalf("unexpected result: %+v", task)
			}
			st, e := s.Snapshot()
			if e != nil {
				t.Fatal(e)
			}
			if st.Accounts[0].Status != "auth_required" {
				t.Fatalf("stale connected account: %+v", st.Accounts[0])
			}
		})
	}
}
