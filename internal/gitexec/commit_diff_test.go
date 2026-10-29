package gitexec

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCommitDiffShowsSelectedCommitRatherThanWorkingTree(t *testing.T) {
	path := initRepo(t)
	r := Runner{}
	ctx := context.Background()
	file := filepath.Join(path, "中文 [config].txt")
	if err := os.WriteFile(file, []byte("original committed line\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := r.Stage(ctx, path, filepath.Base(file), true); err != nil {
		t.Fatal(err)
	}
	if err := r.Commit(ctx, path, "original history subject", "Chosen", "chosen@example.test"); err != nil {
		t.Fatal(err)
	}
	hash := testGit(t, path, "rev-parse", "HEAD")
	if err := os.WriteFile(file, []byte("uncommitted replacement\n"), 0600); err != nil {
		t.Fatal(err)
	}
	diff, err := r.CommitDiff(ctx, path, hash)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(diff, "+original committed line") || strings.Contains(diff, "uncommitted replacement") || strings.Contains(diff, "original history subject") {
		t.Fatalf("wrong selected commit diff: %s", diff)
	}
	working, err := r.Diff(ctx, path, filepath.Base(file), false)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(working, "+uncommitted replacement") || strings.Contains(working, "file changed,") {
		t.Fatalf("working diff is not a plain patch: %s", working)
	}
	for _, invalid := range []string{"HEAD", "--help", hash + "\n", strings.Repeat("z", 40)} {
		if _, err := r.CommitDiff(ctx, path, invalid); err == nil || !strings.HasPrefix(err.Error(), "INVALID_COMMIT:") {
			t.Fatalf("invalid revision accepted: %q %v", invalid, err)
		}
	}
}
