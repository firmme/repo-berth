package service

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
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

func TestWorkingDocumentRejectsOutdatedVersion(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	id, dir := importTestRepository(t, s)
	name := "editor.txt"
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte("initial\n"), 0600); err != nil {
		t.Fatal(err)
	}
	document, err := s.ReadWorkingDocument(id, name)
	if err != nil || document.Content != "initial\n" || document.Version == "" {
		t.Fatalf("read: %+v (%v)", document, err)
	}
	if err := os.WriteFile(path, []byte("external editor\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveWorkingDocument(id, name, "app draft\n", document.Version); err == nil || !strings.Contains(err.Error(), "FILE_CHANGED") {
		t.Fatalf("stale version accepted: %v", err)
	}
	if current, err := os.ReadFile(path); err != nil || string(current) != "external editor\n" {
		t.Fatalf("external changes lost: %q (%v)", current, err)
	}
	document, err = s.ReadWorkingDocument(id, name)
	if err != nil {
		t.Fatal(err)
	}
	version, err := s.SaveWorkingDocument(id, name, "app draft\n", document.Version)
	if err != nil || version == "" || version == document.Version {
		t.Fatalf("save: %q (%v)", version, err)
	}
	if next, err := s.SaveWorkingDocument(id, name, "second save\n", version); err != nil || next == version {
		t.Fatalf("second save: %q (%v)", next, err)
	}
}

func TestWorkspacePathRejectsReparseDirectoriesAndMetadata(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	id, dir := importTestRepository(t, s)
	outside := t.TempDir()
	link := filepath.Join(dir, "linked-directory")
	if runtime.GOOS == "windows" {
		cmd := exec.Command("cmd.exe", "/d", "/c", "mklink", "/J", link, outside)
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("fixture junction: %v %s", err, output)
		}
	} else if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateWorkingFile(id, "linked-directory/new.txt"); err == nil {
		t.Fatal("linked directory accepted")
	}
	if err := s.CreateWorkingFile(id, ".GIT/new.txt"); err == nil {
		t.Fatal("metadata path accepted")
	}
	if _, err := os.Stat(filepath.Join(outside, "new.txt")); !os.IsNotExist(err) {
		t.Fatalf("unexpected file outside workspace: %v", err)
	}
}
