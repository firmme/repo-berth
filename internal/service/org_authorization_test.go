package service

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"repo-berth/internal/provider"
)

func TestPartialOrganizationSyncPreservesCatalogueAndAccess(t *testing.T) {
	repo := provider.Repository{ID: 42, Name: "project", CloneURL: "https://github.com/team/project.git"}
	repo.Owner.Login = "team"
	repo.Permissions.Push = true
	s, _, _ := newTestService(t, &fakeProvider{user: provider.User{ID: 1, Login: "member"}, repos: []provider.Repository{repo}})
	a := authorize(t, s)
	id, err := s.SyncRepositories(a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if task := waitTask(t, s, id); task.State != "succeeded" {
		t.Fatalf("initial sync: %+v", task)
	}
	before, _ := s.Snapshot()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-GitHub-SSO", "partial-results; organizations=123")
		fmt.Fprint(w, `[]`)
	}))
	defer server.Close()
	g := provider.NewGitHub()
	g.API = server.URL
	s.provider = g
	id, err = s.SyncRepositories(a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if task := waitTask(t, s, id); task.ErrorCode != "ORG_AUTH_REQUIRED" {
		t.Fatalf("missing organization authorization not reported: %+v", task)
	}
	after, _ := s.Snapshot()
	if !reflect.DeepEqual(before.Repositories, after.Repositories) || !reflect.DeepEqual(before.Access, after.Access) || !reflect.DeepEqual(before.Accounts, after.Accounts) {
		t.Fatal("partial response overwrote cached repositories, access, or account sync status")
	}
}
