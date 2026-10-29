package gitexec

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestHistoryReportsChangedFilesAndLines(t *testing.T) {
	path := initRepo(t)
	r := Runner{}
	ctx := context.Background()
	write := func(name, body string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(path, name), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	write("a.txt", "one\ntwo\n")
	write("b.txt", "keep\n")
	for _, name := range []string{"a.txt", "b.txt"} {
		if err := r.Stage(ctx, path, name, true); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.Commit(ctx, path, "initial", "Chosen", "chosen@example.test"); err != nil {
		t.Fatal(err)
	}
	write("a.txt", "one\nchanged\nnew\n")
	write("c.txt", "added\n")
	for _, name := range []string{"a.txt", "c.txt"} {
		if err := r.Stage(ctx, path, name, true); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.Commit(ctx, path, "update", "Chosen", "chosen@example.test"); err != nil {
		t.Fatal(err)
	}
	commits, err := r.History(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	if len(commits) != 2 {
		t.Fatalf("history length %d", len(commits))
	}
	latest, first := commits[0], commits[1]
	if latest.Subject != "update" || latest.Files != 2 || latest.Insertions != 3 || latest.Deletions != 1 {
		t.Fatalf("latest stats: %+v", latest)
	}
	if first.Subject != "initial" || first.Files != 2 || first.Insertions != 3 || first.Deletions != 0 {
		t.Fatalf("initial stats: %+v", first)
	}
}
