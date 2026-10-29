package gitexec

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestStageManyStagesAndUnstagesTogether(t *testing.T) {
	path := initRepo(t)
	r := Runner{}
	ctx := context.Background()
	for _, name := range []string{"one.txt", "two.txt"} {
		if err := os.WriteFile(filepath.Join(path, name), []byte(name), 0600); err != nil {
			t.Fatal(err)
		}
	}
	files := []string{"one.txt", "two.txt"}
	if err := r.StageMany(ctx, path, files, true); err != nil {
		t.Fatal(err)
	}
	if got := testGit(t, path, "diff", "--cached", "--name-only"); got != "one.txt\ntwo.txt" {
		t.Fatalf("staged: %q", got)
	}
	if err := r.StageMany(ctx, path, files, false); err != nil {
		t.Fatal(err)
	}
	if got := testGit(t, path, "diff", "--cached", "--name-only"); got != "" {
		t.Fatalf("unstaged: %q", got)
	}
	if err := r.StageMany(ctx, path, files, true); err != nil {
		t.Fatal(err)
	}
	if err := r.Commit(ctx, path, "baseline", "Tester", "tester@example.test"); err != nil {
		t.Fatal(err)
	}
	for _, name := range files {
		if err := os.WriteFile(filepath.Join(path, name), []byte("changed"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.StageMany(ctx, path, files, true); err != nil {
		t.Fatal(err)
	}
	if err := r.StageMany(ctx, path, files, false); err != nil {
		t.Fatal(err)
	}
	if got := testGit(t, path, "diff", "--cached", "--name-only"); got != "" {
		t.Fatalf("unstaged after HEAD: %q", got)
	}
}
