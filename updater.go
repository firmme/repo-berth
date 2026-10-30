package main

import (
	"context"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

const updateRepository = "firmme/repo-berth"

var (
	appVersion      = "dev"
	versionPattern  = regexp.MustCompile(`^\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?$`)
	updateFlowMutex sync.Mutex
)

// configureUpdater wires GitHub Releases-based self-updates. It returns false
// for development builds, where no release version was injected.
func configureUpdater(app *application.App) bool {
	version := strings.TrimSpace(appVersion)
	if !versionPattern.MatchString(version) {
		log.Printf("自动更新已禁用：构建版本无效 (%q)", appVersion)
		return false
	}
	base, err := github.New(github.Config{
		Repository:   updateRepository,
		AssetMatcher: updateAssetMatcher,
	})
	if err != nil {
		log.Printf("自动更新初始化失败：%v", err)
		return false
	}
	provider := &checksumGitHubProvider{
		Provider:   base,
		repository: updateRepository,
		client:     &http.Client{Timeout: 30 * time.Second},
	}
	if err = app.Updater.Init(updater.Config{
		CurrentVersion: version,
		Providers:      []updater.Provider{provider},
		Window: &updater.BuiltinWindow{
			Options: updater.WindowOptions{Title: "检查更新"},
		},
	}); err != nil {
		log.Printf("自动更新初始化失败：%v", err)
		return false
	}
	app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
		go automaticUpdateCheck(app)
	})
	return true
}

// automaticUpdateCheck looks for a newer release after startup and opens the
// update flow only when one exists. Up-to-date startup checks stay silent.
func automaticUpdateCheck(app *application.App) {
	time.Sleep(5 * time.Second)
	if !beginUpdateFlow(app) {
		return
	}
	defer updateFlowMutex.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	release, err := app.Updater.Check(ctx)
	if err != nil {
		log.Printf("检查更新失败：%v", err)
		return
	}
	if release == nil {
		return
	}
	runUpdateFlow(app)
}

// startUpdateCheck is the manual menu entry point.
func startUpdateCheck(app *application.App) {
	go func() {
		if !beginUpdateFlow(app) {
			return
		}
		defer updateFlowMutex.Unlock()
		runUpdateFlow(app)
	}()
}

// beginUpdateFlow prevents two update windows from racing over the same
// staging directory. A staged update stays ready until the user restarts.
func beginUpdateFlow(app *application.App) bool {
	if !updateFlowMutex.TryLock() {
		return false
	}
	switch app.Updater.State() {
	case updater.StateChecking, updater.StateAvailable, updater.StateDownloading, updater.StateVerifying, updater.StateInstalling, updater.StateReady:
		updateFlowMutex.Unlock()
		return false
	}
	return true
}

func runUpdateFlow(app *application.App) {
	if err := app.Updater.CheckAndInstall(context.Background()); err != nil {
		log.Printf("更新失败：%v", err)
	}
}

// updateAssetMatcher selects the dedicated self-update archive from a GitHub
// release. Release assets must contain "-update" plus the platform and
// architecture, because the full distribution archives contain license and
// documentation files that the updater cannot swap into place.
func updateAssetMatcher(req updater.CheckRequest, assets []github.ReleaseAsset) int {
	platform := strings.ToLower(req.Platform)
	arch := strings.ToLower(req.Arch)
	tokens := []string{platform}
	switch platform {
	case "darwin":
		tokens = []string{"macos", "darwin", "osx"}
	case "windows":
		tokens = []string{"windows", "win64", "win32"}
	}
	for i, asset := range assets {
		name := strings.ToLower(asset.Name)
		if !strings.Contains(name, "-update") || !isUpdateArchive(name) {
			continue
		}
		if !containsAny(name, tokens) || !matchesUpdateArch(name, arch) {
			continue
		}
		return i
	}
	return -1
}

func isUpdateArchive(name string) bool {
	return strings.HasSuffix(name, ".zip") ||
		strings.HasSuffix(name, ".tar.gz") ||
		strings.HasSuffix(name, ".tgz")
}

func containsAny(name string, tokens []string) bool {
	for _, token := range tokens {
		if strings.Contains(name, token) {
			return true
		}
	}
	return false
}

func matchesUpdateArch(name, arch string) bool {
	if strings.Contains(name, arch) {
		return true
	}
	switch arch {
	case "amd64":
		return strings.Contains(name, "x86_64") || strings.Contains(name, "x64")
	case "arm64":
		return strings.Contains(name, "aarch64")
	}
	return false
}

type checksumGitHubProvider struct {
	*github.Provider
	repository string
	client     *http.Client
}

// Check adds SHA-256 verification from the update asset's sibling
// ".sha256" file. The GitHub provider only supports one fixed checksum asset
// name, while update archives are published per platform.
func (p *checksumGitHubProvider) Check(ctx context.Context, req updater.CheckRequest) (*updater.Release, error) {
	release, err := p.Provider.Check(ctx, req)
	if err != nil || release == nil {
		return release, err
	}
	tag, _ := release.Metadata["github.release.tag"].(string)
	if tag == "" {
		return nil, fmt.Errorf("update release missing tag")
	}
	sidecar := release.Artifact.Filename + ".sha256"
	endpoint := fmt.Sprintf("https://github.com/%s/releases/download/%s/%s", p.repository, url.PathEscape(tag), url.PathEscape(sidecar))
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	response, err := p.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("download update checksum: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("download update checksum: HTTP %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 64<<10))
	if err != nil {
		return nil, fmt.Errorf("read update checksum: %w", err)
	}
	digest, err := checksumDigest(body, release.Artifact.Filename)
	if err != nil {
		return nil, err
	}
	release.Verification = &updater.Verification{DigestAlgo: "sha256", Digest: digest}
	return release, nil
}

func checksumDigest(body []byte, filename string) ([]byte, error) {
	for _, line := range strings.Split(string(body), "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) < 2 {
			continue
		}
		name := strings.TrimPrefix(fields[len(fields)-1], "*")
		if name != filename {
			continue
		}
		digest, err := hex.DecodeString(fields[0])
		if err != nil || len(digest) != 32 {
			return nil, fmt.Errorf("invalid update checksum for %s", filename)
		}
		return digest, nil
	}
	return nil, fmt.Errorf("update checksum missing for %s", filename)
}
