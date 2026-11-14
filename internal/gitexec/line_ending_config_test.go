package gitexec

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLineEndingConfigPreservesNativeGitPolicyAndIsolation(t *testing.T) {
	ctx := context.Background()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, "xdg"))
	global := filepath.Join(home, ".gitconfig")
	config := "[core]\n autocrlf = input\n eol = lf\n safecrlf = warn\n[user]\n name = Wrong Global Author\n[credential]\n helper = never-run-this-helper\n"
	if err := os.WriteFile(global, []byte(config), 0600); err != nil {
		t.Fatal(err)
	}
	path := initRepo(t)
	r := Runner{}
	for key, want := range map[string]string{"core.autocrlf": "input", "core.eol": "lf", "core.safecrlf": "warn"} {
		got, err := r.Run(ctx, path, nil, nil, "config", "--get", key)
		if err != nil || strings.TrimSpace(got) != want {
			t.Fatalf("%s: got %q want %q err=%v", key, got, want, err)
		}
	}
	if got, err := r.Run(ctx, path, nil, nil, "config", "--get", "user.name"); err == nil || got != "" {
		t.Fatalf("global identity leaked: %q %v", got, err)
	}
	if got, err := r.Run(ctx, path, nil, nil, "config", "--get", "credential.helper"); err != nil || strings.TrimSpace(got) != "" {
		t.Fatalf("global helper leaked: %q %v", got, err)
	}
	writeEOLTestFile(t, path, "file.txt", "one\r\ntwo\r\n")
	if err := r.Stage(ctx, path, "file.txt", true); err != nil {
		t.Fatal(err)
	}
	if got, err := r.Run(ctx, path, nil, nil, "show", ":file.txt"); err != nil || got != "one\ntwo\n" {
		t.Fatalf("native Git input conversion missing: %q %v", got, err)
	}
	testGit(t, path, "config", "core.autocrlf", "false")
	testGit(t, path, "config", "core.safecrlf", "false")
	writeEOLTestFile(t, path, "file.txt", "one\r\nchanged\r\n")
	if err := r.Stage(ctx, path, "file.txt", true); err != nil {
		t.Fatal(err)
	}
	if got, err := r.Run(ctx, path, nil, nil, "show", ":file.txt"); err != nil || got != "one\r\nchanged\r\n" {
		t.Fatalf("explicit local policy was overridden: %q %v", got, err)
	}
	after, err := os.ReadFile(global)
	if err != nil || string(after) != config {
		t.Fatal("global configuration was changed")
	}
	// Configuration edits are picked up immediately, including implicit true.
	if err := os.WriteFile(global, []byte("[core]\n autocrlf\n"), 0600); err != nil {
		t.Fatal(err)
	}
	testGit(t, path, "config", "--unset", "core.autocrlf")
	if got, err := r.Run(ctx, path, nil, nil, "config", "--get", "core.autocrlf"); err != nil || strings.TrimSpace(got) != "true" {
		t.Fatalf("implicit boolean policy lost: %q %v", got, err)
	}
}
