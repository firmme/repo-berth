package service

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
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

func TestSavingUntouchedFilesPreservesBytesAndMtime(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	id, dir := importTestRepository(t, s)
	for _, text := range []string{"one\ntwo\n", "one\r\ntwo\r\n", "one\r\ntwo\n"} {
		full := filepath.Join(dir, "untouched.txt")
		if err := os.WriteFile(full, []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
		stamp := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
		if err := os.Chtimes(full, stamp, stamp); err != nil {
			t.Fatal(err)
		}
		if err := s.SaveWorkingFile(id, "untouched.txt", normalizeLineEndings(text, "LF")); err != nil {
			t.Fatal(err)
		}
		got, err := os.ReadFile(full)
		if err != nil || string(got) != text {
			t.Fatalf("untouched file rewritten: %q %v", got, err)
		}
		info, err := os.Stat(full)
		if err != nil || !info.ModTime().Equal(stamp) {
			t.Fatalf("untouched file mtime changed: %+v %v", info, err)
		}
	}
	state, _ := s.Snapshot()
	for _, task := range state.Tasks {
		if task.Kind == "line_endings" {
			t.Fatal("unchanged file should not generate a format notice")
		}
	}
}

func TestEditedAndNewFilesReportActualLineEndingChanges(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	id, dir := importTestRepository(t, s)
	if err := os.WriteFile(filepath.Join(dir, "mixed.txt"), []byte("one\r\ntwo\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveWorkingFile(id, "mixed.txt", "one\nchanged\n"); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveWorkingFile(id, "new.txt", "new\r\nfile\r\n"); err != nil {
		t.Fatal(err)
	}
	state, _ := s.Snapshot()
	notices := []string{}
	for _, task := range state.Tasks {
		if task.Kind == "line_endings" {
			notices = append(notices, task.Progress)
		}
	}
	if len(notices) != 2 || !strings.Contains(strings.Join(notices, "\n"), "mixed.txt：Mixed → LF") || !strings.Contains(strings.Join(notices, "\n"), "new.txt：CRLF → LF") {
		t.Fatalf("missing format notices: %v", notices)
	}
	for _, name := range []string{"mixed.txt", "new.txt"} {
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil || strings.Contains(string(data), "\r") {
			t.Fatalf("expected saved LF: %s %q %v", name, data, err)
		}
	}
}

func TestNativeStagingConversionNotifiesWithoutRewritingWorkingFile(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	id, dir := importTestRepository(t, s)
	for key, value := range map[string]string{"core.autocrlf": "true", "core.safecrlf": "false"} {
		if _, err := s.runner().Run(s.ctx, dir, nil, nil, "config", key, value); err != nil {
			t.Fatal(err)
		}
	}
	full := filepath.Join(dir, "new.txt")
	if err := os.WriteFile(full, []byte("one\r\ntwo\r\n"), 0600); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := s.StageFile(id, "new.txt", true); err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.ReadFile(full)
	if err != nil || string(data) != "one\r\ntwo\r\n" {
		t.Fatalf("working file rewritten: %q %v", data, err)
	}
	index, err := s.runner().Run(s.ctx, dir, nil, nil, "show", ":new.txt")
	if err != nil || index != "one\ntwo\n" {
		t.Fatalf("native staging conversion missing: %q %v", index, err)
	}
	state, _ := s.Snapshot()
	count := 0
	for _, task := range state.Tasks {
		if task.Kind == "line_endings" {
			count++
			if !strings.Contains(task.Progress, "CRLF → LF（Git 暂存转换，工作文件保持原样）") {
				t.Fatalf("incorrect conversion notice: %+v", task)
			}
		}
	}
	if count != 1 {
		t.Fatalf("expected one notice, got %d", count)
	}
}

func TestStagedLFDoesNotWarnAboutWorkingLineEndings(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	id, dir := importTestRepository(t, s)
	for _, name := range []string{"mixed.txt", "crlf.txt"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("one\ntwo\n"), 0600); err != nil {
			t.Fatal(err)
		}
		if err := s.StageFile(id, name, true); err != nil {
			t.Fatal(err)
		}
		content := "one\r\ntwo\n"
		if name == "crlf.txt" {
			content = "one\r\ntwo\r\n"
		}
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
		risks, err := s.CheckLineEndingRisks(id, []string{name})
		if err != nil || len(risks) != 0 {
			t.Fatalf("normalized index should not warn: %+v %v", risks, err)
		}
	}
}
