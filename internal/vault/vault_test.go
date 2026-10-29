package vault

import (
	"os"
	"testing"

	"repo-berth/internal/model"
)

// Opt in on a desktop session; hosted CI may lack an unlocked keychain.
func TestSystemCredentialRoundtrip(t *testing.T) {
	if os.Getenv("BERTH_KEYRING_INTEGRATION") != "1" {
		t.Skip("requires explicit system keychain integration opt-in")
	}
	ref := "integration-test:" + model.ID()
	v := New()
	t.Cleanup(func() {
		if err := v.Delete(ref); err != nil {
			t.Error(err)
		}
	})
	if err := v.Set(ref, "synthetic-integration-value", false); err != nil {
		t.Fatal(err)
	}
	if value, err := New().Get(ref); err != nil || value != "synthetic-integration-value" {
		t.Fatal("persistent keychain roundtrip failed")
	}
	if err := v.Delete(ref); err != nil {
		t.Fatal(err)
	}
	if _, err := New().Get(ref); err == nil {
		t.Fatal("deleted keychain credential remains")
	}
	sessionRef := "integration-session:" + model.ID()
	if err := v.Set(sessionRef, "synthetic-session-value", true); err != nil {
		t.Fatal(err)
	}
	defer v.Delete(sessionRef)
	if value, err := v.Get(sessionRef); err != nil || value != "synthetic-session-value" {
		t.Fatal("session credential missing")
	}
	if _, err := New().Get(sessionRef); err == nil {
		t.Fatal("session value persisted into system keychain")
	}
}
