package gitexec

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeEOLTestFile(t *testing.T, path, name, content string) {
	t.Helper()
	full := filepath.Join(path, name)
	if err := os.MkdirAll(filepath.Dir(full), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
}

func TestStatusIgnoresOnlyLineEndings(t *testing.T) {
	ctx := context.Background()
	r := Runner{}
	path := initRepo(t)
	testGit(t, path, "config", "core.autocrlf", "false")
	baseline := map[string]string{
		"LF.txt": "one\ntwo\n", "CRLF.txt": "one\r\ntwo\r\n",
		"mixed.txt": "one\ntwo\n", "content.txt": "one\ntwo\n",
		"spaces.txt": "one\ntwo\n", "no-final-newline.txt": "one\ntwo\n",
		"binary.dat": "one\x00\ntwo\n", "deleted.txt": "unique deleted content\n",
		"rename.txt": "one\n", "mode.txt": "one\n",
	}
	for name, content := range baseline {
		writeEOLTestFile(t, path, name, content)
	}
	testGit(t, path, "add", ".")
	testGit(t, path, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "baseline")
	for name, content := range map[string]string{
		"LF.txt": "one\r\ntwo\r\n", "CRLF.txt": "one\ntwo\n",
		"mixed.txt": "one\r\ntwo\n", "content.txt": "one\r\nchanged\r\n",
		"spaces.txt": "one \r\ntwo\r\n", "no-final-newline.txt": "one\ntwo",
		"binary.dat": "one\x00\r\ntwo\r\n", "new-empty.txt": "",
	} {
		writeEOLTestFile(t, path, name, content)
	}
	if err := os.Remove(filepath.Join(path, "deleted.txt")); err != nil {
		t.Fatal(err)
	}
	testGit(t, path, "mv", "rename.txt", "renamed.txt")
	testGit(t, path, "update-index", "--chmod=+x", "mode.txt")
	for _, staged := range []bool{false, true} {
		if staged {
			// External staging must be filtered too.
			testGit(t, path, "add", "--all")
			testGit(t, path, "update-index", "--chmod=+x", "mode.txt")
		}
		status, err := r.Status(ctx, path)
		if err != nil {
			t.Fatal(err)
		}
		files := map[string]FileStatus{}
		for _, file := range status.Files {
			files[file.Path] = file
		}
		for _, name := range []string{"LF.txt", "CRLF.txt", "mixed.txt"} {
			_, ok := files[name]
			if ok != staged {
				t.Errorf("staged=%v: EOL-only staging visibility incorrect: %s", staged, name)
			}
		}
		for _, name := range []string{"content.txt", "spaces.txt", "no-final-newline.txt", "binary.dat", "deleted.txt", "renamed.txt", "mode.txt", "new-empty.txt"} {
			if _, ok := files[name]; !ok {
				t.Errorf("staged=%v: meaningful change hidden: %s", staged, name)
			}
		}
		file := files["content.txt"]
		added, deleted := file.WorktreeAdditions, file.WorktreeDeletions
		if staged {
			added, deleted = file.IndexAdditions, file.IndexDeletions
		}
		if added != 1 || deleted != 1 {
			t.Errorf("staged=%v: inflated stats: %+v", staged, file)
		}
		diff, err := r.Diff(ctx, path, "no-final-newline.txt", staged)
		if err != nil || !strings.Contains(diff, "No newline at end of file") {
			t.Errorf("staged=%v: final-newline diff hidden: %q, %v", staged, diff, err)
		}
	}
}

func TestBulkStageSkipsLineEndingOnlyFilesAndPreservesExternalStaging(t *testing.T) {
	ctx := context.Background()
	r := Runner{}
	path := initRepo(t)
	testGit(t, path, "config", "core.autocrlf", "false")
	for _, name := range []string{"dir/eol.txt", "dir/real.txt"} {
		writeEOLTestFile(t, path, name, "one\ntwo\n")
	}
	testGit(t, path, "add", ".")
	testGit(t, path, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "baseline")
	writeEOLTestFile(t, path, "dir/eol.txt", "one\r\ntwo\r\n")
	writeEOLTestFile(t, path, "dir/real.txt", "one\nchanged\n")
	if err := r.StageMany(ctx, path, []string{"dir"}, true); err != nil {
		t.Fatal(err)
	}
	if got := testGit(t, path, "diff", "--cached", "--name-only"); got != "dir/real.txt" {
		t.Fatalf("bulk staging included EOL noise: %q", got)
	}
	testGit(t, path, "add", "dir/eol.txt")
	if err := r.Commit(ctx, path, "real change", "Test", "test@example.com"); err != nil {
		t.Fatal(err)
	}
	if got := testGit(t, path, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"); got != "dir/eol.txt\ndir/real.txt" {
		t.Fatalf("explicit external staging was changed: %q", got)
	}
	data, err := os.ReadFile(filepath.Join(path, "dir/eol.txt"))
	if err != nil || string(data) != "one\r\ntwo\r\n" {
		t.Fatalf("working file changed: %q, %v", data, err)
	}
}

func TestPartialStagingWithLineEndingOnlyWorktree(t *testing.T) {
	ctx := context.Background()
	r := Runner{}
	path := initRepo(t)
	testGit(t, path, "config", "core.autocrlf", "false")
	writeEOLTestFile(t, path, "file.txt", "original\n")
	testGit(t, path, "add", ".")
	testGit(t, path, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "baseline")
	writeEOLTestFile(t, path, "file.txt", "staged\n")
	testGit(t, path, "add", "file.txt")
	writeEOLTestFile(t, path, "file.txt", "staged\r\n")
	s, err := r.Status(ctx, path)
	if err != nil || len(s.Files) != 1 || s.Files[0].Index != "M" || s.Files[0].Worktree != " " {
		t.Fatalf("staged change lost or fake unstaged side: %+v, %v", s.Files, err)
	}
	if err := r.Stage(ctx, path, "file.txt", true); err != nil {
		t.Fatal(err)
	}
	if err := r.Commit(ctx, path, "staged only", "Test", "test@example.com"); err != nil {
		t.Fatal(err)
	}
	raw, err := r.Run(ctx, path, nil, nil, "show", "HEAD:file.txt")
	if err != nil || raw != "staged\n" {
		t.Fatalf("staged contents changed: %q, %v", raw, err)
	}
}

func TestStageFollowsGitAttributesAndExplicitLocalConfig(t *testing.T) {
	ctx := context.Background()
	r := Runner{}
	path := initRepo(t)
	testGit(t, path, "config", "core.autocrlf", "false")
	writeEOLTestFile(t, path, ".gitattributes", "raw.txt -text\nwindows.txt text eol=crlf\n")
	for _, name := range []string{"mixed.txt", "all.txt", "raw.txt", "binary.dat", "windows.txt"} {
		writeEOLTestFile(t, path, name, "one\ntwo\n")
	}
	testGit(t, path, "add", ".")
	testGit(t, path, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "baseline")
	wanted := map[string]string{
		"mixed.txt": "one\nchanged\r\n", "all.txt": "one\r\nchanged\r\n",
		"raw.txt": "one\r\nchanged\r\n", "binary.dat": "one\x00\r\nchanged\r\n",
		"windows.txt": "one\r\nchanged\r\n", "new.txt": "new\r\nfile\n",
	}
	files := []string{}
	for name, content := range wanted {
		writeEOLTestFile(t, path, name, content)
		files = append(files, name)
	}
	if err := r.StageMany(ctx, path, files, true); err != nil {
		t.Fatal(err)
	}
	for name, original := range wanted {
		want := original
		if name == "windows.txt" {
			want = strings.ReplaceAll(want, "\r\n", "\n")
		}
		got, err := r.Run(ctx, path, nil, nil, "show", ":"+name)
		if err != nil || got != want {
			t.Errorf("%s: staged=%q want=%q err=%v", name, got, want, err)
		}
		data, err := os.ReadFile(filepath.Join(path, name))
		if err != nil || string(data) != original {
			t.Errorf("%s: working file changed: %q err=%v", name, data, err)
		}
	}
}

func TestCommitPreservesStagedSnapshotAndExplicitLocalConfig(t *testing.T) {
	ctx := context.Background()
	r := Runner{}
	path := initRepo(t)
	testGit(t, path, "config", "core.autocrlf", "false")
	writeEOLTestFile(t, path, "file.txt", "one\ntwo\n")
	testGit(t, path, "add", ".")
	testGit(t, path, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "baseline")
	writeEOLTestFile(t, path, "file.txt", "one\nstaged\r\n")
	testGit(t, path, "add", "file.txt")
	testGit(t, path, "update-index", "--chmod=+x", "file.txt")
	writeEOLTestFile(t, path, "file.txt", "unstaged\r\nstaged\r\n")
	if err := r.Commit(ctx, path, "normalize staged snapshot", "Test", "test@example.com"); err != nil {
		t.Fatal(err)
	}
	got, err := r.Run(ctx, path, nil, nil, "show", "HEAD:file.txt")
	if err != nil || got != "one\nstaged\r\n" {
		t.Fatalf("wrong committed snapshot: %q %v", got, err)
	}
	if mode := testGit(t, path, "ls-tree", "HEAD", "file.txt"); !strings.HasPrefix(mode, "100755") {
		t.Fatalf("executable mode lost: %s", mode)
	}
	data, err := os.ReadFile(filepath.Join(path, "file.txt"))
	if err != nil || string(data) != "unstaged\r\nstaged\r\n" {
		t.Fatalf("unstaged content changed: %q %v", data, err)
	}
}
