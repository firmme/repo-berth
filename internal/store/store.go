package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	_ "modernc.org/sqlite"
	"os"
	"path/filepath"
	"repo-berth/internal/model"
)

// Each collection has its own table; JSON payloads keep v1 migrations small while
// cross-collection updates remain atomic. Tokens are never accepted by this layer.
type Store struct{ db *sql.DB }

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db}
	if _, err = db.Exec("PRAGMA busy_timeout=5000;"); err != nil {
		db.Close()
		return nil, err
	}
	tx, err := db.Begin()
	if err != nil {
		db.Close()
		return nil, err
	}
	// Roll back before closing the DB on every initialization failure, including
	// an unsupported future schema. Never create v1 tables in a newer database.
	initialized := false
	defer func() {
		if !initialized {
			_ = tx.Rollback()
			_ = db.Close()
		}
	}()
	if _, err = tx.Exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)"); err != nil {
		return nil, err
	}
	var count, version int
	if err = tx.QueryRow("SELECT COUNT(*), COALESCE(MAX(version),0) FROM schema_version").Scan(&count, &version); err != nil {
		return nil, err
	}
	if count > 1 || count == 1 && (version < 1 || version > 2) {
		return nil, model.Err("SCHEMA_UNSUPPORTED", fmt.Sprintf("数据库版本 %d 不受当前应用支持，请使用匹配或更新版本；原数据库未被修改", version))
	}
	for _, table := range tables {
		if _, err = tx.Exec("CREATE TABLE IF NOT EXISTS " + table + " (id TEXT PRIMARY KEY, payload TEXT NOT NULL)"); err != nil {
			return nil, err
		}
	}
	if _, err = tx.Exec("INSERT INTO schema_version SELECT 2 WHERE NOT EXISTS (SELECT 1 FROM schema_version); UPDATE schema_version SET version=2 WHERE version=1"); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	initialized = true
	if _, err = db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

var tables = []string{"accounts", "commit_profiles", "remote_repositories", "account_repositories", "local_checkouts", "repository_bindings", "groups", "tasks", "settings", "credential_cleanup"}

func (s *Store) Close() error { return s.db.Close() }
func (s *Store) Save(state model.State) error {
	values := []any{state.Accounts, state.Profiles, state.Repositories, state.Access, state.Checkouts, state.Bindings, state.Groups, state.Tasks, state.Settings, state.CredentialCleanup}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for i, table := range tables {
		b, err := json.Marshal(values[i])
		if err != nil {
			return err
		}
		if _, err = tx.Exec("INSERT INTO "+table+"(id,payload) VALUES('state',?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload WHERE payload <> excluded.payload", string(b)); err != nil {
			return err
		}
	}
	return tx.Commit()
}
func (s *Store) Load() (model.State, error) {
	state := model.EmptyState()
	targets := []any{&state.Accounts, &state.Profiles, &state.Repositories, &state.Access, &state.Checkouts, &state.Bindings, &state.Groups, &state.Tasks, &state.Settings, &state.CredentialCleanup}
	for i, table := range tables {
		var payload string
		err := s.db.QueryRow("SELECT payload FROM " + table + " WHERE id='state'").Scan(&payload)
		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			return state, err
		}
		if err = json.Unmarshal([]byte(payload), targets[i]); err != nil {
			return state, err
		}
	}
	return state, nil
}
