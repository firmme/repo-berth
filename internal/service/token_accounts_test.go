package service

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"

	"repo-berth/internal/model"
	"repo-berth/internal/provider"
)

func TestTokenAccountsStayIsolatedAndReplaceOAuthWithoutLosingBindings(t *testing.T) {
	s, vault, path := newTestService(t, &fakeProvider{user: provider.User{ID: 1, Login: "personal"}})
	old := authorize(t, s)
	profile, err := s.SaveProfile(model.CommitProfile{AccountID: old.ID, Name: "Author", Email: "author@example.test"})
	if err != nil {
		t.Fatal(err)
	}
	checkout, _ := importTestRepository(t, s)
	if err := s.BindRepository(model.RepositoryBinding{CheckoutID: checkout, Remote: "origin", AccountID: old.ID, ProfileID: profile}); err != nil {
		t.Fatal(err)
	}
	before, _ := s.Snapshot()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		login, uid := "personal", 1
		switch r.Header.Get("Authorization") {
		case "Bearer test-personal-pat":
		case "Bearer test-work-pat":
			login, uid = "work", 2
		default:
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/user":
			fmt.Fprintf(w, `{"id":%d,"login":%q}`, uid, login)
		case "/user/repos":
			fmt.Fprintf(w, `[{"id":42,"name":"project","clone_url":"https://github.com/team/project.git","owner":{"login":"team"},"permissions":{"push":%t}}]`, uid == 2)
		default:
			t.Errorf("unexpected endpoint %s", r.URL)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	g := provider.NewGitHub()
	g.API = server.URL
	s.provider = g
	for _, in := range []struct{ token, replace string }{{"test-personal-pat", old.ID}, {"test-work-pat", ""}} {
		id, err := s.ConnectToken(in.token, false, in.replace)
		if err != nil {
			t.Fatal(err)
		}
		task := waitTask(t, s, id)
		if task.State != "succeeded" {
			t.Fatalf("connect: %+v", task)
		}
		a, err := s.account(task.Target)
		if err != nil || a.Authentication != "pat" {
			t.Fatalf("account: %+v %v", a, err)
		}
		stored, err := vault.Get(a.CredentialRef)
		if err != nil || stored != in.token {
			t.Fatal("wrong token stored for account")
		}
		id, err = s.SyncRepositories(a.ID)
		if err != nil {
			t.Fatal(err)
		}
		if task := waitTask(t, s, id); task.State != "succeeded" {
			t.Fatalf("sync: %+v", task)
		}
	}
	after, _ := s.Snapshot()
	if len(after.Accounts) != 2 || len(after.Repositories) != 1 || len(after.Access) != 2 || after.Access[0].Push || !after.Access[1].Push {
		t.Fatal("tokens did not retain separate access to shared organization repo")
	}
	if !reflect.DeepEqual(before.Bindings, after.Bindings) || !reflect.DeepEqual(before.Profiles, after.Profiles) {
		t.Fatal("credential replacement changed bindings or authors")
	}
	if after.Accounts[0].ID != old.ID {
		t.Fatal("created a duplicate account instead of replacing OAuth")
	}
	ref := after.Accounts[0].CredentialRef
	for _, token := range []string{"invalid-pat", "test-work-pat"} {
		id, err := s.ConnectToken(token, false, old.ID)
		if err != nil {
			t.Fatal(err)
		}
		if task := waitTask(t, s, id); task.State != "failed" {
			t.Fatal("invalid or mismatched token accepted")
		}
		a, _ := s.account(old.ID)
		if a.CredentialRef != ref {
			t.Fatal("failed replacement overwrote original credential")
		}
	}
	state, _ := s.Snapshot()
	encoded, _ := json.Marshal(state)
	for _, secret := range []string{"test-personal-pat", "test-work-pat", "invalid-pat"} {
		if strings.Contains(string(encoded), secret) {
			t.Fatal("token in snapshot or tasks")
		}
		for _, file := range []string{path, path + "-wal"} {
			bytes, _ := os.ReadFile(file)
			if strings.Contains(string(bytes), secret) {
				t.Fatal("token in database")
			}
		}
	}
}

func TestConnectTokenRejectsEmptyOrMalformedInput(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	for _, token := range []string{"", "  ", "token\r\nvalue", "token value", strings.Repeat("x", 4097)} {
		if _, err := s.ConnectToken(token, false, ""); err == nil {
			t.Fatal("invalid token accepted")
		}
	}
}
