package store

import (
	"database/sql"
	"path/filepath"
	"strings"
	"testing"

	"repo-berth/internal/model"
)

func TestSaveRollbackIsAtomicAcrossCollections(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "中文 database.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	state := model.EmptyState()
	state.Accounts = append(state.Accounts, model.Account{ID: "original"})
	if err = s.Save(state); err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(`CREATE TRIGGER reject_profiles BEFORE UPDATE ON commit_profiles BEGIN SELECT RAISE(ABORT,'simulated write failure'); END`); err != nil {
		t.Fatal(err)
	}
	state.Accounts[0].ID = "must-rollback"
	state.Profiles = append(state.Profiles, model.CommitProfile{ID: "new-profile"})
	if err = s.Save(state); err == nil {
		t.Fatal("expected simulated transaction failure")
	}
	loaded, err := s.Load()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Accounts[0].ID != "original" || len(loaded.Profiles) != 0 {
		t.Fatalf("partial transaction persisted: %+v", loaded)
	}
}

func TestFutureSchemaIsRejectedWithoutCreatingOrReplacingTables(t *testing.T) {
	path := filepath.Join(t.TempDir(), "future.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`CREATE TABLE schema_version(version INTEGER NOT NULL); INSERT INTO schema_version VALUES(99); CREATE TABLE future_data(value TEXT); INSERT INTO future_data VALUES('preserve me');`); err != nil {
		t.Fatal(err)
	}
	_ = db.Close()
	if s, err := Open(path); err == nil {
		_ = s.Close()
		t.Fatal("opened unsupported schema")
	} else if !strings.HasPrefix(err.Error(), "SCHEMA_UNSUPPORTED:") {
		t.Fatalf("wrong error: %v", err)
	}
	db, err = sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var value string
	if err = db.QueryRow("SELECT value FROM future_data").Scan(&value); err != nil || value != "preserve me" {
		t.Fatal("future database contents were modified")
	}
	var count int
	if err = db.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE name='accounts'").Scan(&count); err != nil || count != 0 {
		t.Fatal("created v1 tables in a future schema")
	}
}

func TestUnchangedCollectionsAreNotRewrittenByTaskProgress(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "state.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	state := model.EmptyState()
	if err = s.Save(state); err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(`CREATE TABLE account_writes(value INTEGER); CREATE TRIGGER count_accounts AFTER UPDATE ON accounts BEGIN INSERT INTO account_writes VALUES(1); END;`); err != nil {
		t.Fatal(err)
	}
	state.Tasks = append(state.Tasks, model.Task{ID: "task", State: "running", Progress: "50%"})
	if err = s.Save(state); err != nil {
		t.Fatal(err)
	}
	var count int
	_ = s.db.QueryRow("SELECT COUNT(*) FROM account_writes").Scan(&count)
	if count != 0 {
		t.Fatal("task progress rewrote unchanged account collection")
	}
}
func TestVersionOneMigrationPreservesAccountsAndAddsCleanupJournal(t *testing.T) {
	path := filepath.Join(t.TempDir(), "v1.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	state := model.EmptyState()
	state.Accounts = []model.Account{{ID: "existing", CredentialRef: "legacy-reference"}}
	if err = s.Save(state); err != nil {
		t.Fatal(err)
	}
	_ = s.Close()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("UPDATE schema_version SET version=1; DROP TABLE credential_cleanup"); err != nil {
		t.Fatal(err)
	}
	_ = db.Close()
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	loaded, err := s.Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Accounts) != 1 || loaded.Accounts[0].CredentialRef != "legacy-reference" {
		t.Fatal("migration changed existing account")
	}
	loaded.CredentialCleanup = []string{"unused-reference"}
	if err = s.Save(loaded); err != nil {
		t.Fatal(err)
	}
	var version int
	_ = s.db.QueryRow("SELECT version FROM schema_version").Scan(&version)
	if version != 2 {
		t.Fatalf("schema version %d", version)
	}
}
