package service

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"repo-berth/internal/gitexec"
)

func TestRecoveryServiceRequiresFreshPreviewAndKeepsAccountMetadata(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	id, root := importTestRepository(t, s)
	before, _ := s.Snapshot()
	req := gitexec.RecoveryRequest{Kind: "discard", Paths: []string{"uncommitted.txt"}, IncludeUntracked: true}
	plan, err := s.PreviewGitRecovery(id, req)
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(root, "uncommitted.txt")
	os.WriteFile(file, []byte("new work since preview"), 0600)
	if err := s.ApplyGitRecovery(id, req, plan.Fingerprint); err == nil || !strings.Contains(err.Error(), "RECOVERY_CHANGED") {
		t.Fatalf("stale service request accepted: %v", err)
	}
	plan, err = s.PreviewGitRecovery(id, req)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.ApplyGitRecovery(id, req, plan.Fingerprint); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Fatal("confirmed removal did not execute")
	}
	after, _ := s.Snapshot()
	if len(after.Checkouts) != len(before.Checkouts) || after.Checkouts[0].ID != before.Checkouts[0].ID {
		t.Fatal("discard changed checkout identity")
	}
}

func TestRecoveryServiceRejectsUnmanagedDirectoryAndChangedRepositoryRoot(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	id, root := importTestRepository(t, s)
	req := gitexec.RecoveryRequest{Kind: "discard", All: true}
	if _, err := s.PreviewGitRecovery("missing", req); err == nil {
		t.Fatal("missing checkout accepted")
	}
	// Removing Git metadata is restricted to the synthetic test fixture.
	metadata := filepath.Join(root, ".git")
	if err := os.Rename(metadata, filepath.Join(root, "saved-git")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.PreviewGitRecovery(id, req); err == nil {
		t.Fatal("changed checkout accepted")
	}
}
