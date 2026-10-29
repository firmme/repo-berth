package service

import (
	"os"
	"os/exec"
	"path/filepath"
	"repo-berth/internal/gitexec"
	"repo-berth/internal/model"
	"testing"
)

func TestDefaultCommitIdentityAndProjectOverride(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	id, path := importTestRepository(t, s)
	settings := model.Settings{GitPath: "git", DefaultCommitName: "Default Author", DefaultCommitEmail: "default@example.test"}
	if err := s.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	commit := func(want string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(path, "uncommitted.txt"), []byte(want), 0600); err != nil {
			t.Fatal(err)
		}
		if err := s.StageFile(id, "uncommitted.txt", true); err != nil {
			t.Fatal(err)
		}
		task, err := s.CommitChanges(id, "", want)
		if err != nil {
			t.Fatal(err)
		}
		if result := waitTask(t, s, task); result.State != "succeeded" {
			t.Fatalf("commit: %+v", result)
		}
		cmd := exec.Command("git", "-C", path, "log", "-1", "--format=%an <%ae>")
		cmd.Env = gitexec.CleanEnv()
		out, err := cmd.Output()
		if err != nil || string(out) != want+"\n" {
			t.Fatalf("author: %q %v", out, err)
		}
	}
	commit("Default Author <default@example.test>")
	if err := s.SetCheckoutIdentity(id, "Project Author", "project@example.test"); err != nil {
		t.Fatal(err)
	}
	settings.DefaultCommitName = "Changed Default"
	if err := s.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	commit("Project Author <project@example.test>")
	if err := s.SetCheckoutIdentity(id, "", ""); err != nil {
		t.Fatal(err)
	}
	commit("Changed Default <default@example.test>")
	if err := s.SetCheckoutIdentity(id, "Incomplete", ""); err == nil {
		t.Fatal("accepted partial identity")
	}
}

func TestPlainDirectoriesRequireExplicitImportAndBatchForgetPreservesFiles(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	plain := t.TempDir()
	precious := filepath.Join(plain, "keep.txt")
	os.WriteFile(precious, []byte("keep"), 0600)
	if _, err := s.ImportCheckout(plain); err == nil {
		t.Fatal("ordinary import accepted plain directory")
	}
	st, _ := s.Snapshot()
	if len(st.Checkouts) != 0 {
		t.Fatal("unconfirmed record saved")
	}
	id, err := s.ImportPlainDirectory(plain)
	if err != nil {
		t.Fatal(err)
	}
	duplicate, err := s.ImportPlainDirectory(plain)
	if err != nil || duplicate != id {
		t.Fatalf("duplicate %s %v", duplicate, err)
	}
	st, _ = s.Snapshot()
	if !st.Checkouts[0].PlainDirectory {
		t.Fatal("plain directory not marked")
	}
	if _, err = s.GitStatus(id); err == nil {
		t.Fatal("Git operation accepted plain directory")
	}
	repo, path := importTestRepository(t, s)
	if _, err = s.ImportPlainDirectory(path); err == nil {
		t.Fatal("Git repo accepted as ordinary directory")
	}
	if err = s.ForgetCheckouts([]string{id, "missing"}); err == nil {
		t.Fatal("invalid bulk input accepted")
	}
	st, _ = s.Snapshot()
	if len(st.Checkouts) != 2 {
		t.Fatal("partial removal on validation failure")
	}
	if err = s.change(func(st *model.State) error {
		st.Tasks = append(st.Tasks, model.Task{ID: "queued", Kind: "fetch", Target: repo, State: "queued"})
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err = s.ForgetCheckouts([]string{id, repo}); err == nil {
		t.Fatal("removed busy batch")
	}
	st, _ = s.Snapshot()
	if len(st.Checkouts) != 2 {
		t.Fatal("partially removed busy batch")
	}
	if err = s.change(func(st *model.State) error { st.Tasks = nil; return nil }); err != nil {
		t.Fatal(err)
	}
	if err = s.ForgetCheckouts([]string{id, repo, id}); err != nil {
		t.Fatal(err)
	}
	st, _ = s.Snapshot()
	if len(st.Checkouts) != 0 {
		t.Fatal("records retained")
	}
	for _, p := range []string{precious, filepath.Join(path, ".git", "HEAD"), filepath.Join(path, "uncommitted.txt")} {
		if _, err = os.Stat(p); err != nil {
			t.Fatalf("file removed %s", p)
		}
	}
}

func TestScanDepthTwoAndNoPlainDirectoryImports(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	root := t.TempDir()
	for _, relative := range []string{"first", "group/second", "outside/third/too-deep"} {
		cmd := exec.Command("git", "init", "-b", "main", filepath.Join(root, filepath.FromSlash(relative)))
		cmd.Env = gitexec.CleanEnv()
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("fixture %v %s", err, out)
		}
	}
	os.MkdirAll(filepath.Join(root, "ordinary", "nested"), 0700)
	id, err := s.ScanDirectory(root)
	if err != nil {
		t.Fatal(err)
	}
	task := waitTask(t, s, id)
	if task.State != "succeeded" || task.ScanSummary.Imported != 2 {
		t.Fatalf("scan %+v", task)
	}
	st, _ := s.Snapshot()
	if len(st.Checkouts) != 2 {
		t.Fatalf("unexpected records %+v", st.Checkouts)
	}
	for _, c := range st.Checkouts {
		if c.PlainDirectory {
			t.Fatal("scanner added ordinary directory")
		}
	}
}
