package service

import (
	"bytes"
	"encoding/base64"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func gitCommitAll(t *testing.T, dir, message string) string {
	t.Helper()
	for _, args := range [][]string{
		{"add", "-A"},
		{"-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", message},
		{"rev-parse", "HEAD"},
	} {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
		if args[0] == "rev-parse" {
			return string(bytes.TrimSpace(out))
		}
	}
	return ""
}

func TestCommitBinaryDiffAndMediaPreview(t *testing.T) {
	s, _, _ := newTestService(t, &fakeProvider{})
	id, dir := importTestRepository(t, s)

	binary := []byte{0, 1, 2, 3, 4, 5, 6, 7, 8, 9}
	if err := os.WriteFile(filepath.Join(dir, "blob.bin"), binary, 0o644); err != nil {
		t.Fatal(err)
	}
	first := gitCommitAll(t, dir, "first")
	info, err := s.GitCommitFileInfo(id, first, "blob.bin")
	if err != nil {
		t.Fatal(err)
	}
	if info.PreviewKind != "unsupported" || !info.Binary {
		t.Fatalf("unexpected commit file info: %+v", info)
	}

	changed := append(append([]byte{}, binary...), 10, 11, 12)
	if err := os.WriteFile(filepath.Join(dir, "blob.bin"), changed, 0o644); err != nil {
		t.Fatal(err)
	}
	second := gitCommitAll(t, dir, "second")
	diff, err := s.GitCommitBinaryDiff(id, second, "blob.bin")
	if err != nil {
		t.Fatal(err)
	}
	if !diff.OldExists || diff.OldSize != int64(len(binary)) || diff.NewSize != int64(len(changed)) {
		t.Fatalf("unexpected binary diff sizes: %+v", diff)
	}
	if diff.ChangedBytes != 3 || diff.FirstDifference != len(binary) {
		t.Fatalf("unexpected binary diff: %+v", diff)
	}
	newData, err := base64.StdEncoding.DecodeString(diff.NewData)
	if err != nil || !bytes.Equal(newData, changed) {
		t.Fatalf("unexpected new window: %x %v", newData, err)
	}

	png, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "pixel.png"), png, 0o644); err != nil {
		t.Fatal(err)
	}
	third := gitCommitAll(t, dir, "image")
	info, err = s.GitCommitFileInfo(id, third, "pixel.png")
	if err != nil {
		t.Fatal(err)
	}
	if info.PreviewKind != "image" {
		t.Fatalf("unexpected image info: %+v", info)
	}
	preview, err := s.GitCommitFilePreview(id, third, "pixel.png")
	if err != nil {
		t.Fatal(err)
	}
	if preview.Kind != "image" || preview.MIMEType != "image/png" || preview.Data == "" {
		t.Fatalf("unexpected commit image preview: %+v", preview)
	}

	if err := os.Remove(filepath.Join(dir, "blob.bin")); err != nil {
		t.Fatal(err)
	}
	fourth := gitCommitAll(t, dir, "delete binary")
	info, err = s.GitCommitFileInfo(id, fourth, "blob.bin")
	if err != nil || !info.Binary {
		t.Fatalf("deleted binary info failed: %+v %v", info, err)
	}
	diff, err = s.GitCommitBinaryDiff(id, fourth, "blob.bin")
	if err != nil {
		t.Fatal(err)
	}
	if diff.NewExists || !diff.OldExists || diff.NewSize != 0 {
		t.Fatalf("unexpected deleted binary diff: %+v", diff)
	}
}
