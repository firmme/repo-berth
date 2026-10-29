package service

import (
	"repo-berth/internal/model"
	"testing"
)

func TestAccountIdentityReplacesLegacyDuplicatesAndPreservesProjectAuthor(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	id, _ := importTestRepository(t, s)
	if err := s.change(func(st *model.State) error {
		st.Accounts = []model.Account{{ID: "personal", Login: "personal", Host: "github.com"}}
		st.Profiles = []model.CommitProfile{
			{ID: "primary", AccountID: "personal", Name: "Primary", Email: "primary@example.test"},
			{ID: "other", AccountID: "personal", Name: "Project", Email: "project@example.test"},
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.BindRepository(model.RepositoryBinding{CheckoutID: id, Remote: "origin", AccountID: "personal", ProfileID: "other"}); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveSettings(model.Settings{GitPath: "git", DefaultCommitName: "Old Global", DefaultCommitEmail: "global@example.test"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveProfile(model.CommitProfile{ID: "primary", AccountID: "personal", Name: "New Primary", Email: "new@example.test"}); err != nil {
		t.Fatal(err)
	}
	st, _ := s.Snapshot()
	if len(st.Profiles) != 1 || st.Profiles[0].ID != "primary" || st.Bindings[0].ProfileID != "primary" {
		t.Fatalf("legacy profiles were not consolidated: %+v %+v", st.Profiles, st.Bindings)
	}
	p, err := s.commitIdentity(id, "origin")
	if err != nil || p.Name != "Project" {
		t.Fatalf("project author was not preserved: %+v %v", p, err)
	}
	if err := s.SetCheckoutIdentity(id, "", ""); err != nil {
		t.Fatal(err)
	}
	p, err = s.commitIdentity(id, "origin")
	if err != nil || p.Name != "New Primary" {
		t.Fatalf("account identity did not take precedence over old global default: %+v %v", p, err)
	}
}

func TestNormalizeAccountProfilesPreservesLegacyBoundAuthor(t *testing.T) {
	st := model.EmptyState()
	st.Profiles = []model.CommitProfile{
		{ID: "main", AccountID: "personal", Name: "Main", Email: "main@example.test"},
		{ID: "second", AccountID: "personal", Name: "Second", Email: "second@example.test"},
	}
	st.Checkouts = []model.LocalCheckout{{ID: "project"}}
	st.Bindings = []model.RepositoryBinding{{AccountID: "personal", CheckoutID: "project", ProfileID: "second"}}
	normalizeAccountProfiles(&st)
	if len(st.Profiles) != 1 || st.Bindings[0].ProfileID != "main" || st.Checkouts[0].CommitName != "Second" {
		t.Fatalf("legacy author not preserved: %+v %+v %+v", st.Profiles, st.Bindings, st.Checkouts)
	}
	normalizeAccountProfiles(&st)
	if len(st.Profiles) != 1 || st.Checkouts[0].CommitEmail != "second@example.test" {
		t.Fatal("normalization was not idempotent")
	}
}
