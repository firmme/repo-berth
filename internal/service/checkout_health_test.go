package service

import (
	"os"
	"path/filepath"
	"testing"

	"repo-berth/internal/model"
)

func TestCheckoutHealthReportsHealthyAndDamagedGitMetadata(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	id, dir := importTestRepository(t, s)

	health, err := s.CheckoutHealth(id)
	if err != nil {
		t.Fatal(err)
	}
	if health.State != CheckoutOK {
		t.Fatalf("healthy repository reported %+v", health)
	}

	headPath := filepath.Join(dir, ".git", "HEAD")
	if err = os.Remove(headPath); err != nil {
		t.Fatal(err)
	}
	health, err = s.CheckoutHealth(id)
	if err != nil {
		t.Fatal(err)
	}
	if health.State != CheckoutCorrupted || health.Message == "" {
		t.Fatalf("damaged repository reported %+v", health)
	}
	if _, err = os.Stat(filepath.Join(dir, "uncommitted.txt")); err != nil {
		t.Fatal("health check modified the working tree")
	}
	if err = s.ForgetCheckout(id); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(dir, "uncommitted.txt")); err != nil {
		t.Fatal("forgetting a damaged repository deleted working files")
	}
}

func TestCheckoutHealthReportsMissingDirectoryAndPlainDirectories(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	id, dir := importTestRepository(t, s)
	if err := os.RemoveAll(dir); err != nil {
		t.Fatal(err)
	}
	health, err := s.CheckoutHealth(id)
	if err != nil {
		t.Fatal(err)
	}
	if health.State != CheckoutMissing {
		t.Fatalf("missing directory reported %+v", health)
	}

	plain := t.TempDir()
	plainID, err := s.ImportPlainDirectory(plain)
	if err != nil {
		t.Fatal(err)
	}
	health, err = s.CheckoutHealth(plainID)
	if err != nil {
		t.Fatal(err)
	}
	if health.State != CheckoutPlain {
		t.Fatalf("plain directory reported %+v", health)
	}
}

func TestCheckoutHealthReportsMissingGitMetadata(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	id, dir := importTestRepository(t, s)
	if err := os.RemoveAll(filepath.Join(dir, ".git")); err != nil {
		t.Fatal(err)
	}
	health, err := s.CheckoutHealth(id)
	if err != nil {
		t.Fatal(err)
	}
	if health.State != CheckoutCorrupted || health.Message == "" {
		t.Fatalf("missing .git reported %+v", health)
	}
}

func TestCheckoutHealthDoesNotMistakeMissingGitForCorruption(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	id, _ := importTestRepository(t, s)
	if err := s.SaveSettings(model.Settings{GitPath: filepath.Join(t.TempDir(), "missing-git")}); err != nil {
		t.Fatal(err)
	}
	health, err := s.CheckoutHealth(id)
	if err != nil {
		t.Fatal(err)
	}
	if health.State != CheckoutGitUnavailable {
		t.Fatalf("missing Git reported %+v", health)
	}
}

func TestCheckoutHealthRejectsUnknownCheckout(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	if _, err := s.CheckoutHealth("missing"); err == nil {
		t.Fatal("unknown checkout was accepted")
	}
}

func TestCheckoutHealthTreatsMalformedGitFileAsCorrupted(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, ".git"), []byte("not a gitdir pointer"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := s.change(func(st *model.State) error {
		st.Checkouts = append(st.Checkouts, model.LocalCheckout{ID: "damaged", Path: dir, Name: "damaged"})
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	health, err := s.CheckoutHealth("damaged")
	if err != nil {
		t.Fatal(err)
	}
	if health.State != CheckoutCorrupted {
		t.Fatalf("malformed .git file reported %+v", health)
	}
}
