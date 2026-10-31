package service

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestFileEditingIgnoreAndUntrack(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	id, dir := importTestRepository(t, s)

	tracked := filepath.Join(dir, "tracked.txt")
	if err := os.WriteFile(tracked, []byte("tracked\n"), 0600); err != nil {
		t.Fatal(err)
	}
	run := func(args ...string) string {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
		return strings.TrimSpace(string(out))
	}
	run("add", "tracked.txt")
	run("-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "base")

	if err := s.CreateWorkingFile(id, "src/new.txt"); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveWorkingFile(id, "src/new.txt", "hello\nworld\n"); err != nil {
		t.Fatal(err)
	}
	content, err := s.GitFileContent(id, "src/new.txt")
	if err != nil || content != "hello\nworld\n" {
		t.Fatalf("content %q err %v", content, err)
	}
	if _, err := s.GitFileContent(id, "../outside.txt"); err == nil {
		t.Fatal("path traversal was accepted")
	}
	if err := s.CreateWorkingFile(id, "src/new.txt"); err == nil {
		t.Fatal("existing file was overwritten")
	}

	if err := s.AddToGitignore(id, "src", true); err != nil {
		t.Fatal(err)
	}
	if err := s.AddToGitignore(id, "src", true); err != nil {
		t.Fatal(err)
	}
	ignore, err := os.ReadFile(filepath.Join(dir, ".gitignore"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(ignore), "/src/") != 1 {
		t.Fatalf(".gitignore pattern duplicated: %q", ignore)
	}

	if err := os.WriteFile(filepath.Join(dir, "other.txt"), []byte("other\n"), 0600); err != nil {
		t.Fatal(err)
	}
	entries, err := s.GitFiles(id)
	if err != nil {
		t.Fatal(err)
	}
	paths := map[string]bool{}
	ignored := map[string]bool{}
	for _, entry := range entries {
		paths[entry.Path] = true
		ignored[entry.Path] = entry.Ignored
	}
	if !paths["tracked.txt"] || !paths["other.txt"] || !paths["src/new.txt"] || !ignored["src/new.txt"] {
		t.Fatalf("unexpected complete file list: %+v", entries)
	}

	if err := s.UntrackFile(id, "tracked.txt", false); err != nil {
		t.Fatal(err)
	}
	if files := run("ls-files", "tracked.txt"); files != "" {
		t.Fatalf("tracked file still in index: %q", files)
	}
	if _, err := os.Stat(tracked); err != nil {
		t.Fatal("untrack removed the working file")
	}
}
