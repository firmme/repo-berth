package service

import (
	"bytes"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

func TestInspectAndConvertWorkingFile(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	id, dir := importTestRepository(t, s)

	path := filepath.Join(dir, "notice.txt")
	if err := os.WriteFile(path, []byte("\xef\xbb\xbfhello\r\nworld\r\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	info, err := s.InspectWorkingFile(id, "notice.txt")
	if err != nil {
		t.Fatal(err)
	}
	if info.Encoding != "UTF-8 BOM" || info.LineEnding != "CRLF" || info.Binary || info.PreviewKind != "text" {
		t.Fatalf("unexpected file info: %+v", info)
	}
	text, err := s.GitFileContent(id, "notice.txt")
	if err != nil || text != "hello\r\nworld\r\n" {
		t.Fatalf("unexpected decoded content: %q, %v", text, err)
	}
	if err := s.SetWorkingFileFormat(id, "notice.txt", "UTF-16 LE", "LF"); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(raw, []byte{0xff, 0xfe}) {
		t.Fatalf("missing UTF-16 BOM: %x", raw)
	}
	info, err = s.InspectWorkingFile(id, "notice.txt")
	if err != nil {
		t.Fatal(err)
	}
	if info.Encoding != "UTF-16 LE" || info.LineEnding != "LF" {
		t.Fatalf("format was not updated: %+v", info)
	}
	if err := s.SaveWorkingFile(id, "notice.txt", "updated\ntext\n"); err != nil {
		t.Fatal(err)
	}
	raw, err = os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(raw, []byte{0xff, 0xfe}) {
		t.Fatalf("save did not preserve the encoding: %x", raw)
	}
	info, err = s.InspectWorkingFile(id, "notice.txt")
	if err != nil {
		t.Fatal(err)
	}
	if info.Encoding != "UTF-16 LE" || info.LineEnding != "LF" {
		t.Fatalf("save did not preserve the format: %+v", info)
	}
	text, err = s.GitFileContent(id, "notice.txt")
	if err != nil || text != "updated\ntext\n" {
		t.Fatalf("unexpected saved content: %q, %v", text, err)
	}
}

func TestWorkingFilePreviewKinds(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	id, dir := importTestRepository(t, s)

	png, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "pixel.png"), png, 0o644); err != nil {
		t.Fatal(err)
	}
	info, err := s.InspectWorkingFile(id, "pixel.png")
	if err != nil {
		t.Fatal(err)
	}
	if info.PreviewKind != "image" || info.MIMEType != "image/png" {
		t.Fatalf("unexpected image info: %+v", info)
	}
	preview, err := s.ReadWorkingFilePreview(id, "pixel.png")
	if err != nil {
		t.Fatal(err)
	}
	if preview.Kind != "image" || preview.MIMEType != "image/png" || len(preview.Data) == 0 {
		t.Fatalf("unexpected preview: %+v", preview)
	}

	if err := os.WriteFile(filepath.Join(dir, "blob.bin"), []byte{0, 1, 2, 3, 0}, 0o644); err != nil {
		t.Fatal(err)
	}
	info, err = s.InspectWorkingFile(id, "blob.bin")
	if err != nil {
		t.Fatal(err)
	}
	if !info.Binary || info.PreviewKind != "unsupported" {
		t.Fatalf("unexpected binary info: %+v", info)
	}
	if _, err := s.ReadWorkingFilePreview(id, "blob.bin"); err == nil {
		t.Fatal("unsupported preview should fail")
	}
}

func TestWorkingPathOperations(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	id, dir := importTestRepository(t, s)

	if err := s.CreateWorkingDirectory(id, "docs/notes"); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateWorkingFile(id, "docs/notes/a.txt"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "docs", "notes", "a.txt"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := s.RenameWorkingPath(id, "docs/notes/a.txt", "b.txt"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "docs", "notes", "b.txt")); err != nil {
		t.Fatal(err)
	}
	if err := s.CopyWorkingPath(id, "docs/notes/b.txt", "docs", false); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "docs", "b.txt")); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateWorkingDirectory(id, "archive"); err != nil {
		t.Fatal(err)
	}
	if err := s.CopyWorkingPath(id, "docs/b.txt", "archive", true); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "archive", "b.txt")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "docs", "b.txt")); !os.IsNotExist(err) {
		t.Fatalf("source was not moved: %v", err)
	}
	if err := s.DeleteWorkingPath(id, "docs"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "docs")); !os.IsNotExist(err) {
		t.Fatalf("docs was not deleted: %v", err)
	}
}
