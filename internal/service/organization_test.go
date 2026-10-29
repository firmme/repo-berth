package service

import (
	"os/exec"
	"reflect"
	"testing"

	"repo-berth/internal/model"
	"repo-berth/internal/provider"
)

func TestImportBeforeSyncPreservesOrganizationAndExplicitUnfavorite(t *testing.T) {
	p := &fakeProvider{user: provider.User{ID: 1, Login: "personal"}}
	s, _, _ := newTestService(t, p)
	a := authorize(t, s)
	ids := []string{}
	for _, url := range []string{"https://github.com/team/project.git", "git@github.com:team/project.git"} {
		path := t.TempDir()
		for _, args := range [][]string{{"init", "-b", "main"}, {"remote", "add", "origin", url}} {
			cmd := exec.Command("git", args...)
			cmd.Dir = path
			if out, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("fixture: %v %s", err, out)
			}
		}
		id, err := s.ImportCheckout(path)
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	if err := s.ToggleFavorite(ids[0]); err != nil {
		t.Fatal(err)
	}
	group, err := s.SaveGroup(model.Group{Name: "Work", Members: []string{ids[0], ids[1]}})
	if err != nil {
		t.Fatal(err)
	}
	repo := provider.Repository{ID: 42, Name: "project", CloneURL: "https://github.com/team/project.git"}
	repo.Owner.Login = "team"
	p.repos = []provider.Repository{repo}
	id, err := s.SyncRepositories(a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if task := waitTask(t, s, id); task.State != "succeeded" {
		t.Fatalf("sync: %+v", task)
	}
	st, err := s.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	remote := st.Repositories[0]
	if !remote.Favorite || remote.LastOpened == "" || len(st.Checkouts) != 2 {
		t.Fatalf("lost organization: %+v", st)
	}
	if !reflect.DeepEqual(st.Groups[0].Members, []string{remote.ID}) {
		t.Fatalf("group did not merge copies: %+v", st.Groups)
	}
	for _, c := range st.Checkouts {
		if c.RepositoryID != remote.ID || c.Favorite {
			t.Fatalf("untransferred metadata: %+v", c)
		}
	}
	// Stale UI requests using the previous local ID must address the merged
	// repository, not an invisible per-copy flag.
	if err = s.ToggleFavorite(ids[0]); err != nil {
		t.Fatal(err)
	}
	if _, err = s.SaveGroup(model.Group{ID: group, Name: "Work", Members: []string{ids[1], remote.ID, ids[0]}}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.ImportCheckout(st.Checkouts[0].Path); err != nil {
		t.Fatal(err)
	}
	id, err = s.SyncRepositories(a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if task := waitTask(t, s, id); task.State != "succeeded" {
		t.Fatalf("resync: %+v", task)
	}
	st, _ = s.Snapshot()
	if st.Repositories[0].Favorite {
		t.Fatal("reimport/sync resurrected an explicit unfavorite")
	}
	if !reflect.DeepEqual(st.Groups[0].Members, []string{remote.ID}) {
		t.Fatalf("stale group IDs not canonicalized: %+v", st.Groups)
	}
}

func TestStartupRepairsAlreadyAssociatedOrganizationOnce(t *testing.T) {
	s, v, path := newTestService(t, &fakeProvider{})
	if err := s.change(func(st *model.State) error {
		st.Repositories = []model.RemoteRepository{{ID: "remote"}}
		st.Checkouts = []model.LocalCheckout{{ID: "local", RepositoryID: "remote", Favorite: true, LastOpened: "2026-10-29T03:00:00Z"}}
		st.Groups = []model.Group{{ID: "group", Name: "Work", Members: []string{"local", "remote"}}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	Close(s)
	reopened, err := New(path, &fakeProvider{}, v)
	if err != nil {
		t.Fatal(err)
	}
	defer Close(reopened)
	st, _ := reopened.Snapshot()
	if !st.Repositories[0].Favorite || st.Checkouts[0].Favorite || st.Repositories[0].LastOpened != st.Checkouts[0].LastOpened {
		t.Fatalf("startup lost metadata: %+v", st)
	}
	if !reflect.DeepEqual(st.Groups[0].Members, []string{"remote"}) {
		t.Fatalf("startup groups: %+v", st.Groups)
	}
	if err = reopened.ToggleFavorite("remote"); err != nil {
		t.Fatal(err)
	}
	Close(reopened)
	again, err := New(path, &fakeProvider{}, v)
	if err != nil {
		t.Fatal(err)
	}
	defer Close(again)
	st, _ = again.Snapshot()
	if st.Repositories[0].Favorite {
		t.Fatal("second startup resurrected favorite")
	}
}

func TestAssociationPrefersOriginAndKeepsUnassociatedMembership(t *testing.T) {
	st := model.EmptyState()
	st.Repositories = []model.RemoteRepository{{ID: "upstream", CloneURL: "https://github.com/team/base.git"}, {ID: "fork", CloneURL: "https://github.com/personal/fork.git"}}
	st.Checkouts = []model.LocalCheckout{{ID: "local", Remotes: []model.CheckoutRemote{{Name: "a-upstream", URL: st.Repositories[0].CloneURL}, {Name: "origin", URL: st.Repositories[1].CloneURL}}}, {ID: "offline", Favorite: true}}
	st.Groups = []model.Group{{ID: "group", Members: []string{"local", "offline"}}}
	associate(&st)
	if st.Checkouts[0].RepositoryID != "fork" {
		t.Fatal("non-origin remote associated fork with wrong cloud entry")
	}
	if !st.Checkouts[1].Favorite || !reflect.DeepEqual(st.Groups[0].Members, []string{"fork", "offline"}) {
		t.Fatalf("unassociated organization changed: %+v", st)
	}
	if len(st.Bindings) != 0 {
		t.Fatal("association guessed an access identity")
	}
}
