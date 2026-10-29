package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"repo-berth/internal/model"
	"repo-berth/internal/provider"
)

type faultVault struct {
	mu                 sync.Mutex
	values             map[string]string
	failSet            bool
	writeBeforeFailure bool
	failDelete         bool
	deletions          int
}

func (v *faultVault) Get(ref string) (string, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if token, ok := v.values[ref]; ok {
		return token, nil
	}
	return "", model.Err("AUTH_REQUIRED", "missing")
}
func (v *faultVault) Set(ref, token string, session bool) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.failSet && !session {
		if v.writeBeforeFailure {
			v.values[ref] = token
		}
		return model.Err("VAULT_UNAVAILABLE", "injected failure: "+token)
	}
	v.values[ref] = token
	return nil
}
func (v *faultVault) Delete(ref string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.deletions++
	if v.failDelete {
		return model.Err("VAULT_UNAVAILABLE", "locked")
	}
	delete(v.values, ref)
	return nil
}
func (v *faultVault) configure(set, afterWrite, remove bool) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.failSet = set
	v.writeBeforeFailure = afterWrite
	v.failDelete = remove
}
func (v *faultVault) count() int { v.mu.Lock(); defer v.mu.Unlock(); return len(v.values) }
func credentialTestService(t *testing.T, p *fakeProvider, v *faultVault) (*Service, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "state.db")
	s, err := New(path, p, v)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { Close(s) })
	if err = s.SaveSettings(model.Settings{GitPath: "git", ClientID: "client"}); err != nil {
		t.Fatal(err)
	}
	return s, path
}
func failAccountWrites(t *testing.T, path string) func() {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`CREATE TRIGGER reject_account_change BEFORE UPDATE ON accounts BEGIN SELECT RAISE(ABORT,'simulated disk write error'); END`); err != nil {
		db.Close()
		t.Fatal(err)
	}
	var once sync.Once
	remove := func() {
		once.Do(func() {
			if _, err := db.Exec("DROP TRIGGER reject_account_change"); err != nil {
				t.Error(err)
			}
			_ = db.Close()
		})
	}
	t.Cleanup(remove)
	return remove
}

func TestReauthorizationFailurePreservesOldCredentialAndCanResume(t *testing.T) {
	var polls atomic.Int32
	p := &fakeProvider{user: provider.User{ID: 1, Login: "personal"}, poll: func(context.Context) (string, error) {
		if polls.Add(1) == 1 {
			return "old-private-secret", nil
		}
		return "new-private-secret", nil
	}}
	v := &faultVault{values: map[string]string{}}
	s, path := credentialTestService(t, p, v)
	old := authorize(t, s)
	unblock := failAccountWrites(t, path)
	auth, err := s.StartAuthorization(false, old.ID)
	if err != nil {
		t.Fatal(err)
	}
	task := waitTask(t, s, auth.TaskID)
	if task.ErrorCode != "STORAGE_WRITE" {
		t.Fatalf("wrong failure: %+v", task)
	}
	state, _ := s.Snapshot()
	if state.Accounts[0].CredentialRef != old.CredentialRef {
		t.Fatal("failed save replaced old pointer")
	}
	token, err := v.Get(old.CredentialRef)
	if err != nil || token != "old-private-secret" {
		t.Fatal("old credential was overwritten")
	}
	if v.count() != 1 {
		t.Fatal("failed write left an untracked new credential")
	}
	if !task.CanResumeAuthorization {
		t.Fatal("completed browser authorization was discarded")
	}
	encoded, _ := json.Marshal(state)
	if strings.Contains(string(encoded), "private-secret") {
		t.Fatal("recovery leaked token into frontend snapshot")
	}
	unblock()
	next, err := s.RecoverAuthorization(auth.TaskID, false)
	if err != nil {
		t.Fatal(err)
	}
	if result := waitTask(t, s, next); result.State != "succeeded" {
		t.Fatalf("recovery failed: %+v", result)
	}
	state, _ = s.Snapshot()
	if len(state.Accounts) != 1 || state.Accounts[0].ID != old.ID || state.Accounts[0].CredentialRef == old.CredentialRef {
		t.Fatal("recovery changed identity or reused old credential slot")
	}
	token, err = v.Get(state.Accounts[0].CredentialRef)
	if err != nil || token != "new-private-secret" {
		t.Fatal("new authorization not published")
	}
	if v.count() != 1 {
		t.Fatal("old credential not reclaimed")
	}
	if polls.Load() != 2 {
		t.Fatal("recovery repeated browser authorization")
	}
}

func TestVaultFailureCanFallBackToExplicitSessionWithoutBrowser(t *testing.T) {
	var polls atomic.Int32
	p := &fakeProvider{user: provider.User{ID: 1, Login: "personal"}, poll: func(context.Context) (string, error) { polls.Add(1); return "session-private-secret", nil }}
	v := &faultVault{values: map[string]string{}, failSet: true, writeBeforeFailure: true, failDelete: true}
	s, _ := credentialTestService(t, p, v)
	auth, err := s.StartAuthorization(false, "")
	if err != nil {
		t.Fatal(err)
	}
	result := waitTask(t, s, auth.TaskID)
	if result.ErrorCode != "VAULT_UNAVAILABLE" || !result.CanResumeAuthorization {
		t.Fatalf("no recoverable save: %+v", result)
	}
	state, _ := s.Snapshot()
	if len(state.Accounts) != 0 || state.PendingCredentialCleanupCount != 1 {
		t.Fatal("partial keychain write was not journaled")
	}
	encoded, _ := json.Marshal(state)
	if strings.Contains(string(encoded), "session-private-secret") || strings.Contains(string(encoded), "credentialCleanup\"") {
		t.Fatal("private state exposed")
	}
	next, err := s.RecoverAuthorization(auth.TaskID, true)
	if err != nil {
		t.Fatal(err)
	}
	if result = waitTask(t, s, next); result.State != "succeeded" {
		t.Fatalf("session fallback: %+v", result)
	}
	state, _ = s.Snapshot()
	if len(state.Accounts) != 1 || !state.Accounts[0].SessionOnly {
		t.Fatal("explicit session mode not applied")
	}
	if polls.Load() != 1 {
		t.Fatal("fallback performed browser flow again")
	}
	v.configure(false, false, false)
	cleanup, err := s.RetryCredentialCleanup()
	if err != nil {
		t.Fatal(err)
	}
	if task := waitTask(t, s, cleanup); task.State != "succeeded" {
		t.Fatalf("cleanup %+v", task)
	}
	state, _ = s.Snapshot()
	if state.PendingCredentialCleanupCount != 0 || v.count() != 1 {
		t.Fatal("deferred cleanup removed active credential or retained abandoned key")
	}
}

func TestRemoveAccountFailureDoesNotDeleteCurrentSecret(t *testing.T) {
	p := &fakeProvider{user: provider.User{ID: 1, Login: "personal"}}
	v := &faultVault{values: map[string]string{}}
	s, path := credentialTestService(t, p, v)
	account := authorize(t, s)
	_ = failAccountWrites(t, path)
	if err := s.RemoveAccount(account.ID); err == nil || !strings.HasPrefix(err.Error(), "STORAGE_WRITE:") {
		t.Fatalf("unexpected remove result: %v", err)
	}
	state, _ := s.Snapshot()
	if len(state.Accounts) != 1 || len(state.CredentialCleanup) != 0 || state.PendingCredentialCleanupCount != 0 {
		t.Fatal("failed removal changed account or journal")
	}
	if _, err := v.Get(account.CredentialRef); err != nil {
		t.Fatal("secret deleted before DB commit")
	}
}

func TestDeferredRemovalCleanupSurvivesRestart(t *testing.T) {
	p := &fakeProvider{user: provider.User{ID: 1, Login: "personal"}}
	v := &faultVault{values: map[string]string{}}
	s, path := credentialTestService(t, p, v)
	account := authorize(t, s)
	v.configure(false, false, true)
	if err := s.RemoveAccount(account.ID); err != nil {
		t.Fatal(err)
	}
	state, _ := s.Snapshot()
	if len(state.Accounts) != 0 || state.PendingCredentialCleanupCount != 1 {
		t.Fatal("removal did not expose deferred cleanup")
	}
	if _, err := s.account(account.ID); err == nil {
		t.Fatal("removed account remained accessible")
	}
	Close(s)
	v.configure(false, false, false)
	reopened, err := New(path, p, v)
	if err != nil {
		t.Fatal(err)
	}
	defer Close(reopened)
	deadline := time.Now().Add(5 * time.Second)
	for {
		state, _ = reopened.Snapshot()
		if state.PendingCredentialCleanupCount == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("startup did not replay pending cleanup")
		}
		time.Sleep(5 * time.Millisecond)
	}
	if v.count() != 0 {
		t.Fatal("orphaned credential survived startup replay")
	}
}

func TestAuthorizationRecoveryExpiryAndCancelDiscardMemory(t *testing.T) {
	p := &fakeProvider{user: provider.User{ID: 1, Login: "personal"}}
	v := &faultVault{values: map[string]string{}, failSet: true}
	s, _ := credentialTestService(t, p, v)
	auth, _ := s.StartAuthorization(false, "")
	waitTask(t, s, auth.TaskID)
	s.mu.Lock()
	s.pendingAuthorizations[auth.TaskID].expiresAt = time.Now().Add(-time.Second)
	s.mu.Unlock()
	if _, err := s.RecoverAuthorization(auth.TaskID, true); err == nil || !strings.HasPrefix(err.Error(), "AUTH_RECOVERY_EXPIRED:") {
		t.Fatalf("expired recovery accepted: %v", err)
	}
	auth, _ = s.StartAuthorization(false, "")
	waitTask(t, s, auth.TaskID)
	_ = s.CancelTask(auth.TaskID)
	if _, err := s.RecoverAuthorization(auth.TaskID, true); err == nil {
		t.Fatal("cancelled authorization token retained")
	}
}
func TestReauthorizationCanUseSessionModeWithoutLosingBindings(t *testing.T) {
	p := &fakeProvider{user: provider.User{ID: 1, Login: "personal"}}
	v := &faultVault{values: map[string]string{}}
	s, _ := credentialTestService(t, p, v)
	account := authorize(t, s)
	if err := s.UpdateAccount(account.ID, "Work identity", "#945e13"); err != nil {
		t.Fatal(err)
	}
	checkout, _ := importTestRepository(t, s)
	profile, err := s.SaveProfile(model.CommitProfile{AccountID: account.ID, Name: "Work", Email: "work@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.BindRepository(model.RepositoryBinding{CheckoutID: checkout, Remote: "origin", AccountID: account.ID, ProfileID: profile}); err != nil {
		t.Fatal(err)
	}
	auth, err := s.StartAuthorization(true, account.ID)
	if err != nil {
		t.Fatal(err)
	}
	if task := waitTask(t, s, auth.TaskID); task.State != "succeeded" {
		t.Fatalf("mode switch: %+v", task)
	}
	state, _ := s.Snapshot()
	if len(state.Accounts) != 1 || state.Accounts[0].ID != account.ID || !state.Accounts[0].SessionOnly || state.Accounts[0].Note != "Work identity" {
		t.Fatal("reauthorization lost account metadata")
	}
	if len(state.Bindings) != 1 || state.Bindings[0].AccountID != account.ID || state.Bindings[0].ProfileID != profile {
		t.Fatal("reauthorization lost bindings")
	}
	if v.count() != 1 {
		t.Fatal("old persistent credential not reclaimed")
	}
}
func TestRemovingAccountDiscardsItsRecoverableAuthorization(t *testing.T) {
	p := &fakeProvider{user: provider.User{ID: 1, Login: "personal"}}
	v := &faultVault{values: map[string]string{}}
	s, _ := credentialTestService(t, p, v)
	account := authorize(t, s)
	v.configure(true, false, false)
	auth, err := s.StartAuthorization(false, account.ID)
	if err != nil {
		t.Fatal(err)
	}
	if task := waitTask(t, s, auth.TaskID); !task.CanResumeAuthorization {
		t.Fatal("expected pending save")
	}
	if err = s.RemoveAccount(account.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.RecoverAuthorization(auth.TaskID, true); err == nil {
		t.Fatal("removed account's unfinished authorization remained recoverable")
	}
}
func TestUnusedRecoveryExpiresWithoutSnapshotPolling(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	s.retainAuthorization("unused", authorizedIdentity{token: "private-unused-value", expiresAt: time.Now().Add(30 * time.Millisecond)}, model.Err("VAULT_UNAVAILABLE", "locked"))
	deadline := time.Now().Add(2 * time.Second)
	for {
		s.mu.Lock()
		_, ok := s.pendingAuthorizations["unused"]
		s.mu.Unlock()
		if !ok {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("unused token retained without polling")
		}
		time.Sleep(5 * time.Millisecond)
	}
}
func TestStartupReclaimsPreparedCredentialWithoutDeletingActiveOne(t *testing.T) {
	p := &fakeProvider{user: provider.User{ID: 1, Login: "personal"}}
	v := &faultVault{values: map[string]string{}}
	s, path := credentialTestService(t, p, v)
	account := authorize(t, s)
	if err := v.Set("interrupted-new-reference", "unpublished-private-value", false); err != nil {
		t.Fatal(err)
	}
	if err := s.addCredentialCandidates("interrupted-new-reference", account.CredentialRef); err != nil {
		t.Fatal(err)
	}
	Close(s)
	reopened, err := New(path, p, v)
	if err != nil {
		t.Fatal(err)
	}
	defer Close(reopened)
	deadline := time.Now().Add(5 * time.Second)
	for {
		state, _ := reopened.Snapshot()
		if state.PendingCredentialCleanupCount == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("prepared credential not reclaimed")
		}
		time.Sleep(5 * time.Millisecond)
	}
	if _, err = v.Get(account.CredentialRef); err != nil {
		t.Fatal("startup cleanup deleted the active credential")
	}
	if _, err = v.Get("interrupted-new-reference"); err == nil {
		t.Fatal("unpublished credential retained")
	}
}
