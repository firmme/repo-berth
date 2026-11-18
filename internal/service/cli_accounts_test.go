package service

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"repo-berth/internal/ghauth"
	"repo-berth/internal/provider"
)

type fakeGitHubCLI struct {
	requested  []string
	active     string
	loginCalls int
}

func (c *fakeGitHubCLI) Accounts(context.Context) ([]ghauth.Account, error) {
	return []ghauth.Account{{Login: "personal", Active: c.active == "personal", State: "success"}, {Login: "work", Active: c.active == "work", State: "success"}}, nil
}
func (c *fakeGitHubCLI) Token(_ context.Context, login string) (string, error) {
	c.requested = append(c.requested, login)
	return "synthetic-cli-" + login, nil
}
func (c *fakeGitHubCLI) Login(_ context.Context, code func(string)) error {
	c.loginCalls++
	code("TEST-CODE")
	c.active = "work"
	return nil
}

func TestCLIConnectionsUseExplicitAccountNotGlobalActiveIdentity(t *testing.T) {
	p := &fakeProvider{user: provider.User{ID: 1, Login: "personal"}}
	s, vault, _ := newTestService(t, p)
	c := &fakeGitHubCLI{active: "work"}
	s.githubCLI = c
	id, err := s.ConnectGitHubCLI("personal", "", false)
	if err != nil {
		t.Fatal(err)
	}
	task := waitTask(t, s, id)
	if task.State != "succeeded" || c.requested[0] != "personal" || c.active != "work" || c.loginCalls != 0 {
		t.Fatalf("selected wrong account or switched global identity: %+v %+v", task, c)
	}
	a, _ := s.account(task.Target)
	if a.Authentication != "github-cli" {
		t.Fatal("CLI login mode not persisted")
	}
	if token, _ := vault.Get(a.CredentialRef); token != "synthetic-cli-personal" {
		t.Fatal("wrong CLI credential cached")
	}
	ref := a.CredentialRef
	p.user = provider.User{ID: 2, Login: "work"}
	id, err = s.ConnectGitHubCLI("", a.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if result := waitTask(t, s, id); result.ErrorCode != "ACCOUNT_MISMATCH" {
		t.Fatal("browser logged into wrong replacement account without rejection")
	}
	a, _ = s.account(a.ID)
	if a.CredentialRef != ref {
		t.Fatal("replaced original account with different CLI login")
	}
	id, err = s.ConnectGitHubCLI("", "", true)
	if err != nil {
		t.Fatal(err)
	}
	if result := waitTask(t, s, id); result.State != "succeeded" {
		t.Fatalf("CLI browser login failed: %+v", result)
	}
	state, _ := s.Snapshot()
	if len(state.Accounts) != 2 || c.requested[len(c.requested)-1] != "work" {
		t.Fatal("did not connect browser login as independent second account")
	}
	encoded, _ := json.Marshal(state)
	if strings.Contains(string(encoded), "synthetic-cli-") {
		t.Fatal("CLI credential leaked in snapshot or tasks")
	}
}

func TestCLIImportRejectsCredentialIdentityMismatch(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{user: provider.User{ID: 2, Login: "work"}})
	s.githubCLI = &fakeGitHubCLI{}
	id, err := s.ConnectGitHubCLI("personal", "", false)
	if err != nil {
		t.Fatal(err)
	}
	if result := waitTask(t, s, id); result.ErrorCode != "ACCOUNT_MISMATCH" {
		t.Fatal("mismatched CLI credential accepted")
	}
	state, _ := s.Snapshot()
	if len(state.Accounts) != 0 {
		t.Fatal("mismatched import created an account")
	}
}
