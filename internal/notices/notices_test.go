package notices

import "testing"

func TestEmbeddedNotices(t *testing.T) {
	inventory, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if inventory.SchemaVersion != 1 || inventory.Version == "" {
		t.Fatalf("unexpected inventory: %+v", inventory)
	}
	if inventory.Compressed <= 0 || inventory.Compressed > 200<<10 {
		t.Fatalf("unexpected compressed size: %d", inventory.Compressed)
	}
	if len(inventory.Dependencies) < 10 {
		t.Fatalf("notices missing dependencies: %d", len(inventory.Dependencies))
	}
	for _, dependency := range inventory.Dependencies {
		if len(dependency.Licenses) == 0 || dependency.Licenses[0].Text == "" {
			t.Fatalf("dependency missing license text: %+v", dependency)
		}
	}
}
