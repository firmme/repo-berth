package service

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLineEndingRisksRespectGitattributesAndFix(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	id, dir := importTestRepository(t, s)

	if err := os.WriteFile(filepath.Join(dir, "mixed.txt"), []byte("one\r\ntwo\nthree\r\n"), 0600); err != nil {
		t.Fatal(err)
	}
	risks, err := s.CheckLineEndingRisks(id, []string{"mixed.txt"})
	if err != nil {
		t.Fatal(err)
	}
	if len(risks) != 1 || !risks[0].Mixed || risks[0].CRLF != 2 || risks[0].LF != 1 {
		t.Fatalf("unexpected risks: %+v", risks)
	}
	if err := s.FixLineEndings(id, []string{"mixed.txt"}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(dir, "mixed.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "\r") {
		t.Fatalf("file was not normalized to LF: %q", data)
	}
	risks, err = s.CheckLineEndingRisks(id, []string{"mixed.txt"})
	if err != nil {
		t.Fatal(err)
	}
	if len(risks) != 0 {
		t.Fatalf("risk remained after fix: %+v", risks)
	}

	if err := os.WriteFile(filepath.Join(dir, ".gitattributes"), []byte("*.crlf text eol=crlf\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "line.crlf"), []byte("one\ntwo\n"), 0600); err != nil {
		t.Fatal(err)
	}
	risks, err = s.CheckLineEndingRisks(id, []string{"line.crlf"})
	if err != nil {
		t.Fatal(err)
	}
	if len(risks) != 1 || risks[0].Policy != "crlf" {
		t.Fatalf("gitattributes policy was not applied: %+v", risks)
	}
	if err := s.FixLineEndings(id, []string{"line.crlf"}); err != nil {
		t.Fatal(err)
	}
	data, err = os.ReadFile(filepath.Join(dir, "line.crlf"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "\r\n") {
		t.Fatalf("crlf policy was not preserved: %q", data)
	}
}
