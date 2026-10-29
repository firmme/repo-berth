package service

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"repo-berth/internal/gitexec"
	"testing"
)

func TestRepositoryRunnerUsesConcreteRootsWithoutSeparateConfirmation(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	id, path := importTestRepository(t, s)
	canonical, _ := gitexec.Canonical(path)
	nested := filepath.Join(path, "nested", "folder")
	if err := os.MkdirAll(nested, 0700); err != nil {
		t.Fatal(err)
	}
	runner := s.repositoryRunner(nested)
	found := false
	for _, p := range runner.TrustedDirectories {
		if p == canonical {
			found = true
		}
		if p == filepath.Dir(canonical) || p == "*" {
			t.Fatal("trust scope expanded")
		}
	}
	if !found {
		t.Fatal("selected root missing")
	}
	if root, err := runner.Root(context.Background(), nested); err != nil || root != canonical {
		t.Fatalf("nested import root %s %v", root, err)
	}
	if err := s.ForgetCheckout(id); err != nil {
		t.Fatal(err)
	}
	for _, p := range s.runner().TrustedDirectories {
		if p == canonical {
			t.Fatal("forgotten checkout retained")
		}
	}
}

// Optional read-only verification against user-supplied paths. No imports,
// repository writes, global configuration changes or ownership changes.
func TestRepositoryRunnerReadOnlyExistingPaths(t *testing.T) {
	raw := os.Getenv("BERTH_MANAGED_READONLY_PATHS")
	if raw == "" {
		t.Skip("read-only diagnostics not requested")
	}
	var paths []string
	if err := json.Unmarshal([]byte(raw), &paths); err != nil {
		t.Fatal(err)
	}
	s, _, _ := newTestService(t, &fakeProvider{})
	for _, path := range paths {
		runner := s.repositoryRunner(path)
		if _, err := runner.Root(context.Background(), path); err != nil {
			t.Errorf("%s root: %v", filepath.Base(path), err)
			continue
		}
		if _, err := runner.Remotes(context.Background(), path); err != nil {
			t.Errorf("%s remotes: %v", filepath.Base(path), err)
		}
	}
}
