package service

import (
	"testing"

	"repo-berth/internal/model"
)

type recordingDesktop struct {
	path     string
	kind     string
	editor   string
	terminal string
}

func (d *recordingDesktop) OpenURL(string) error { return nil }
func (d *recordingDesktop) PickDirectory() (string, error) {
	return "", nil
}
func (d *recordingDesktop) OpenPath(path, kind, editor string) error {
	d.path, d.kind, d.editor = path, kind, editor
	return nil
}
func (d *recordingDesktop) OpenTerminal(path, terminal string) error {
	d.path, d.kind, d.terminal = path, "terminal", terminal
	return nil
}

func TestOpenCheckoutUsesConfiguredTerminal(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	id, _ := importTestRepository(t, s)
	if err := s.SaveSettings(model.Settings{GitPath: "git", TerminalPath: "  /usr/bin/kitty  "}); err != nil {
		t.Fatal(err)
	}
	state, err := s.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if state.Settings.TerminalPath != "/usr/bin/kitty" {
		t.Fatalf("terminal setting was not trimmed: %q", state.Settings.TerminalPath)
	}
	dir := state.Checkouts[0].Path

	d := &recordingDesktop{}
	Attach(s, d, func(string, any) {})
	if err = s.OpenCheckout(id, "terminal"); err != nil {
		t.Fatal(err)
	}
	if d.kind != "terminal" || d.terminal != "/usr/bin/kitty" || d.path != dir {
		t.Fatalf("terminal launch = %+v", d)
	}

	d = &recordingDesktop{}
	Attach(s, d, func(string, any) {})
	if err = s.OpenWorkingPath(id, "", "terminal"); err != nil {
		t.Fatal(err)
	}
	if d.terminal != "/usr/bin/kitty" || d.path != dir {
		t.Fatalf("working path terminal launch = %+v", d)
	}
}
