package gitexec

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOwnershipUsesOnlyExplicitProtectedTrustAndKeepsIdentityIsolated(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, "xdg"))
	repo := t.TempDir()
	other := t.TempDir()
	testGit(t, repo, "init", "-b", "main")
	testGit(t, other, "init", "-b", "main")
	global := filepath.Join(home, ".gitconfig")
	before := []byte("[user]\n name = Wrong Global Author\n email = wrong@example.test\n[credential]\n helper = never-run-this-helper\n[safe]\n directory = " + filepath.ToSlash(repo) + "\n")
	if err := os.WriteFile(global, before, 0600); err != nil {
		t.Fatal(err)
	}
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("BERTH_FAKE_OWNERSHIP", "1")
	r := Runner{Binary: exe}
	if _, err = r.Root(context.Background(), repo); err != nil {
		t.Fatalf("explicitly trusted repo rejected: %v", err)
	}
	if _, err = r.Root(context.Background(), other); err == nil || !strings.HasPrefix(err.Error(), "DUBIOUS_OWNERSHIP:") {
		t.Fatalf("untrusted repo accepted: %v", err)
	}
	if out, err := r.Run(context.Background(), repo, nil, nil, "config", "--get", "user.name"); err == nil || out != "" {
		t.Fatalf("global identity leaked: %q %v", out, err)
	}
	r.TrustedDirectories = []string{other}
	if _, err = r.Root(context.Background(), other); err != nil {
		t.Fatalf("app-specific trust rejected: %v", err)
	}
	after, err := os.ReadFile(global)
	if err != nil || string(after) != string(before) {
		t.Fatal("global configuration changed")
	}
	// A later empty safe.directory entry revokes earlier global entries.
	if err = os.WriteFile(global, append(before, []byte(" directory =\n")...), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = r.Root(context.Background(), repo); err == nil {
		t.Fatal("ignored trust reset")
	}
}

// Opt-in read-only diagnostics on real repositories. It never runs status,
// stages files, writes repository config, or imports into the user's database.
func TestOwnershipReadOnlyExistingPaths(t *testing.T) {
	raw := os.Getenv("BERTH_OWNERSHIP_READONLY_PATHS")
	if raw == "" {
		t.Skip("read-only local diagnosis not requested")
	}
	var paths []struct {
		Path    string
		Trusted bool
	}
	if err := json.Unmarshal([]byte(raw), &paths); err != nil {
		t.Fatal(err)
	}
	for _, item := range paths {
		_, err := (Runner{}).Root(context.Background(), item.Path)
		if (err == nil) != item.Trusted {
			t.Errorf("%s: %v", filepath.Base(item.Path), err)
		}
		if item.Trusted && err == nil {
			if _, err = (Runner{}).Remotes(context.Background(), item.Path); err != nil {
				t.Errorf("%s: remotes: %v", filepath.Base(item.Path), err)
			}
		}
	}
}
