package main

import (
	"testing"

	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

func TestUpdateAssetMatcherSelectsDedicatedUpdateArchives(t *testing.T) {
	assets := []github.ReleaseAsset{
		{Name: "RepoBerth-0.2.8-windows-amd64.zip"},
		{Name: "RepoBerth-0.2.8-windows-amd64.zip.sha256"},
		{Name: "RepoBerth-0.2.8-windows-amd64-update.zip"},
		{Name: "RepoBerth-0.2.8-macos-arm64.zip"},
		{Name: "RepoBerth-0.2.8-macos-arm64-update.zip"},
		{Name: "RepoBerth-0.2.8-linux-amd64-update.tar.gz"},
	}
	tests := []struct {
		platform string
		arch     string
		want     string
	}{
		{"windows", "amd64", "RepoBerth-0.2.8-windows-amd64-update.zip"},
		{"darwin", "arm64", "RepoBerth-0.2.8-macos-arm64-update.zip"},
		{"linux", "amd64", "RepoBerth-0.2.8-linux-amd64-update.tar.gz"},
	}
	for _, test := range tests {
		index := updateAssetMatcher(updater.CheckRequest{Platform: test.platform, Arch: test.arch}, assets)
		if index < 0 || assets[index].Name != test.want {
			t.Fatalf("%s/%s selected %d, want %s", test.platform, test.arch, index, test.want)
		}
	}
}

func TestUpdateAssetMatcherDoesNotUseFullDistributionArchive(t *testing.T) {
	assets := []github.ReleaseAsset{
		{Name: "RepoBerth-0.2.8-macos-arm64.zip"},
		{Name: "RepoBerth-0.2.8-macos-arm64.zip.sha256"},
	}
	if got := updateAssetMatcher(updater.CheckRequest{Platform: "darwin", Arch: "arm64"}, assets); got != -1 {
		t.Fatalf("selected non-update asset at %d", got)
	}
}

func TestChecksumDigestParsesSha256Sidecar(t *testing.T) {
	body := []byte("00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff  RepoBerth-0.2.8-macos-arm64-update.zip\n")
	digest, err := checksumDigest(body, "RepoBerth-0.2.8-macos-arm64-update.zip")
	if err != nil || len(digest) != 32 {
		t.Fatalf("digest: %x %v", digest, err)
	}
	if _, err := checksumDigest(body, "another.zip"); err == nil {
		t.Fatal("missing checksum accepted")
	}
}
