package service

import (
	"repo-berth/internal/model"
	"testing"
)

func accountFixture(t *testing.T, s *Service) {
	t.Helper()
	if err := s.change(func(st *model.State) error {
		st.Accounts = []model.Account{{ID: "personal", Login: "person", Host: "github.com"}, {ID: "work", Login: "employee", Host: "github.com"}}
		st.Profiles = []model.CommitProfile{{ID: "author", AccountID: "personal", Name: "Author", Email: "author@example.test"}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestAccessSelectionBindsCurrentRemoteAndRemembersFallbackIndependently(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	accountFixture(t, s)
	id, _ := importTestRepository(t, s)
	other, _ := importTestRepository(t, s)
	if err := s.BindRepository(model.RepositoryBinding{CheckoutID: id, Remote: "origin", AccountID: "personal", ProfileID: "author"}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetAccessAccount("", "", "work"); err != nil {
		t.Fatal(err)
	}
	b, _, err := s.binding(id, "origin")
	if err != nil || b.AccountID != "personal" {
		t.Fatalf("bound account lost %v %+v", err, b)
	}
	b, p, err := s.binding(other, "origin")
	if err != nil || b.AccountID != "work" || p.Name != "" {
		t.Fatalf("fallback without commit profile rejected %v %+v", err, b)
	}
	if err = s.SetAccessAccount(id, "origin", "work"); err != nil {
		t.Fatal(err)
	}
	b, p, err = s.binding(id, "origin")
	if err != nil || b.AccountID != "work" || p.Name != "" {
		t.Fatalf("selection kept the previous account's author or wrong access %v %+v %+v", err, b, p)
	}
	if err = s.SetAccessAccount("", "", "personal"); err != nil {
		t.Fatal(err)
	}
	b, _, _ = s.binding(id, "origin")
	if b.AccountID != "work" {
		t.Fatal("default overwrote repository choice")
	}
	b, _, _ = s.binding(other, "origin")
	if b.AccountID != "personal" {
		t.Fatal("unbound repository ignored new default")
	}
	if err = s.SaveSettings(model.Settings{GitPath: "git", DefaultCommitName: "Default", DefaultCommitEmail: "default@example.test"}); err != nil {
		t.Fatal(err)
	}
	st, _ := s.Snapshot()
	if st.Settings.DefaultAccountID != "personal" || len(st.Checkouts) != 2 {
		t.Fatal("settings forgot selection or changed checkout")
	}
	if err = s.SetAccessAccount(id, "missing", "personal"); err == nil {
		t.Fatal("missing remote accepted")
	}
	st, _ = s.Snapshot()
	if st.Settings.DefaultAccountID != "personal" {
		t.Fatal("failed selection changed default")
	}
	persisted, err := s.store.Load()
	if err != nil || persisted.Settings.DefaultAccountID != "personal" {
		t.Fatal("default account not persisted")
	}
	if err = s.RemoveAccount("personal"); err != nil {
		t.Fatal(err)
	}
	st, _ = s.Snapshot()
	if st.Settings.DefaultAccountID != "" {
		t.Fatal("removed account retained as default")
	}
}

func TestQueuedNetworkRejectsChangedFallbackBeforeUsingCredentials(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	accountFixture(t, s)
	id, path := importTestRepository(t, s)
	if err := s.SetAccessAccount("", "", "work"); err != nil {
		t.Fatal(err)
	}
	lock := s.workLock(path)
	if err := lock.Lock(s.ctx); err != nil {
		t.Fatal(err)
	}
	task, err := s.GitNetwork(id, "origin", "fetch")
	if err != nil {
		lock.Unlock()
		t.Fatal(err)
	}
	err = s.SetAccessAccount("", "", "personal")
	lock.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	result := waitTask(t, s, task)
	if result.ErrorCode != "BINDING_CHANGED" {
		t.Fatalf("changed fallback was used: %+v", result)
	}
}

func TestAutomaticAssociationUsesUniqueAccessNotOwnerAndRetainsExplicitChoices(t *testing.T) {
	st := model.EmptyState()
	st.Accounts = []model.Account{{ID: "personal", Login: "unrelated-user"}, {ID: "work", Login: "organization"}}
	st.Repositories = []model.RemoteRepository{{ID: "repo", Owner: "organization", CloneURL: "https://github.com/organization/project.git"}}
	st.Checkouts = []model.LocalCheckout{{ID: "copy", Remotes: []model.CheckoutRemote{{Name: "origin", URL: "git@github.com:organization/project.git"}}}}
	st.Access = []model.AccountRepository{{AccountID: "personal", RepositoryID: "repo"}}
	associate(&st)
	if len(st.Bindings) != 1 || st.Bindings[0].AccountID != "personal" || !st.Bindings[0].Automatic {
		t.Fatalf("did not use unique access %+v", st.Bindings)
	}
	st.Access = append(st.Access, model.AccountRepository{AccountID: "work", RepositoryID: "repo"})
	associate(&st)
	if len(st.Bindings) != 0 {
		t.Fatal("guessed identity for shared access")
	}
	st.Settings.DefaultAccountID = "work"
	b, _, err := accessBinding(&st, "copy", "origin")
	if err != nil || b.AccountID != "work" {
		t.Fatal("ambiguous repository did not use default")
	}
	st.Bindings = []model.RepositoryBinding{{ID: "copy:origin", CheckoutID: "copy", Remote: "origin", AccountID: "personal"}}
	associate(&st)
	if len(st.Bindings) != 1 || st.Bindings[0].AccountID != "personal" || st.Bindings[0].Automatic {
		t.Fatal("replaced explicit choice")
	}
	st.Checkouts = append(st.Checkouts, model.LocalCheckout{ID: "unknown", Remotes: []model.CheckoutRemote{{Name: "origin", URL: "https://github.com/organization/unknown.git"}}})
	associate(&st)
	for _, b := range st.Bindings {
		if b.CheckoutID == "unknown" {
			t.Fatal("guessed account from owner")
		}
	}
}
