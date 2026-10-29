package service

import (
	"database/sql"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"repo-berth/internal/gitexec"
)

func TestScanStopsOnStorageFailureRatherThanSkippingValidRepositories(t *testing.T) {
	s, _, dbPath := newTestService(t, &fakeProvider{})
	root := t.TempDir()
	cmd := exec.Command("git", "init", "-b", "main", filepath.Join(root, "valid"))
	cmd.Env = gitexec.CleanEnv()
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("fixture: %v %s", err, out)
	}
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err = db.Exec(`CREATE TRIGGER fail_scan_import BEFORE UPDATE ON local_checkouts BEGIN SELECT RAISE(ABORT,'synthetic disk failure'); END`); err != nil {
		t.Fatal(err)
	}
	id, err := s.ScanDirectory(root)
	if err != nil {
		t.Fatal(err)
	}
	task := waitTask(t, s, id)
	if task.ErrorCode != "STORAGE_WRITE" || task.ScanSummary.Skipped != 0 {
		t.Fatalf("storage failure was treated as a bad candidate: %+v", task)
	}
	st, _ := s.Snapshot()
	if len(st.Checkouts) != 0 {
		t.Fatal("failed persistence retained phantom checkout")
	}
}

func TestScanContinuesAfterInvalidCandidatesAndFindsLinkedWorktrees(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	root := t.TempDir()
	run := func(dir string, args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = gitexec.CleanEnv()
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
	}
	broken := filepath.Join(root, "a-broken")
	if err := os.MkdirAll(broken, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(broken, ".git"), []byte("gitdir: missing-fixture-path"), 0600); err != nil {
		t.Fatal(err)
	}
	main := filepath.Join(root, "b-main")
	run(root, "init", "-b", "main", main)
	if err := os.WriteFile(filepath.Join(main, "file.txt"), []byte("seed"), 0600); err != nil {
		t.Fatal(err)
	}
	run(main, "add", ".")
	run(main, "-c", "user.name=Seed", "-c", "user.email=seed@example.test", "commit", "-m", "seed")
	linked := filepath.Join(root, "c-linked")
	run(main, "worktree", "add", "--detach", linked)
	unsafe := filepath.Join(root, "d-unsafe")
	run(root, "init", "-b", "main", unsafe)
	run(unsafe, "remote", "add", "origin", "https://synthetic-user:synthetic-secret@github.com/org/private.git")
	ignored := filepath.Join(root, "node_modules", "ignored")
	run(root, "init", "-b", "main", ignored)
	id, err := s.ScanDirectory(root)
	if err != nil {
		t.Fatal(err)
	}
	task := waitTask(t, s, id)
	if task.State != "failed" || task.ErrorCode != "SCAN_PARTIAL" || task.ScanSummary == nil || task.ScanSummary.Imported != 2 || task.ScanSummary.Skipped != 2 {
		t.Fatalf("scan did not retain partial results: %+v", task)
	}
	st, _ := s.Snapshot()
	if len(st.Checkouts) != 2 {
		t.Fatalf("valid siblings/worktree not imported: %+v", st.Checkouts)
	}
	for _, c := range st.Checkouts {
		if c.Name != "b-main" && c.Name != "c-linked" {
			t.Fatalf("unexpected scan result %+v", c)
		}
	}
	encoded, _ := json.Marshal(st)
	if strings.Contains(string(encoded), "synthetic-secret") {
		t.Fatal("candidate remote credential entered persisted task/state")
	}
	if len(task.ScanSummary.Issues) != 2 || task.ScanSummary.Issues[0].Path != "a-broken" || task.ScanSummary.Issues[1].Code != "REMOTE_CREDENTIALS" {
		t.Fatalf("missing safe issue detail: %+v", task.ScanSummary)
	}
	if err := os.Remove(filepath.Join(broken, ".git")); err != nil {
		t.Fatal(err)
	}
	run(root, "init", "-b", "main", broken)
	run(unsafe, "remote", "set-url", "origin", "https://github.com/org/private.git")
	id, err = s.ScanDirectory(root)
	if err != nil {
		t.Fatal(err)
	}
	task = waitTask(t, s, id)
	if task.State != "succeeded" || task.ScanSummary.Imported != 4 || task.ScanSummary.Skipped != 0 {
		t.Fatalf("repaired retry: %+v", task)
	}
	st, _ = s.Snapshot()
	if len(st.Checkouts) != 4 {
		t.Fatalf("retry duplicated records: %+v", st.Checkouts)
	}
}

func TestScanRejectsFileAndReportsEmptyDirectory(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	root := t.TempDir()
	file := filepath.Join(root, "file.txt")
	if err := os.WriteFile(file, []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ScanDirectory(file); err == nil || !strings.HasPrefix(err.Error(), "INVALID_PATH:") {
		t.Fatalf("file scan accepted: %v", err)
	}
	id, err := s.ScanDirectory(root)
	if err != nil {
		t.Fatal(err)
	}
	task := waitTask(t, s, id)
	if task.State != "succeeded" || task.ScanSummary == nil || task.ScanSummary.Imported != 0 || task.ScanSummary.Skipped != 0 {
		t.Fatalf("empty directory reported misleading result: %+v", task)
	}
}
