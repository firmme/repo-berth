package gitexec

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"repo-berth/internal/model"
	"strings"
	"testing"
	"time"
)

func TestMain(m *testing.M) {
	if os.Getenv("BERTH_FAKE_OWNERSHIP") == "1" {
		cmd := exec.Command("git", os.Args[1:]...)
		cmd.Env = append(os.Environ(), "GIT_TEST_ASSUME_DIFFERENT_OWNER=1")
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			if e, ok := err.(*exec.ExitError); ok {
				os.Exit(e.ExitCode())
			}
			os.Exit(127)
		}
		os.Exit(0)
	}
	if len(os.Args) > 1 && os.Args[1] == "--credential-helper" {
		os.Exit(HelperMain(os.Args[2:]))
	}
	if os.Getenv("BERTH_FAKE_GIT") == "1" {
		args := os.Args[1:]
		for len(args) >= 2 && args[0] == "-c" {
			args = args[2:]
		}
		switch {
		case len(args) == 1 && args[0] == "--version":
			fmt.Fprintln(os.Stdout, os.Getenv("BERTH_TEST_VERSION"))
		case len(args) == 1 && args[0] == "remote":
			fmt.Fprintln(os.Stdout, "origin")
		case len(args) > 1 && args[0] == "remote" && args[1] == "get-url":
			fmt.Fprintln(os.Stdout, "https://github.com/org/project.git")
		case len(args) > 0 && args[0] == "symbolic-ref":
			fmt.Fprintln(os.Stdout, "main")
		case len(args) > 0 && args[0] == "for-each-ref":
			fmt.Fprint(os.Stdout, "origin\x00refs/heads/main\n")
		default:
			b, _ := json.Marshal(args)
			_ = os.WriteFile(os.Getenv("BERTH_CAPTURE"), b, 0600)
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}
func testGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-c", "core.quotepath=false"}, args...)...)
	cmd.Dir = dir
	cmd.Env = CleanEnv()
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v %s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}
func initRepo(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "中文 repo")
	if err := os.MkdirAll(path, 0700); err != nil {
		t.Fatal(err)
	}
	testGit(t, path, "init", "-b", "main")
	return path
}
func TestCommitIdentitiesAndLiteralPaths(t *testing.T) {
	r := Runner{Binary: "git"}
	ctx := context.Background()
	global := filepath.Join(t.TempDir(), "global.config")
	if err := os.WriteFile(global, []byte("[user]\nname = Global\nemail = global@example.com\n"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GIT_CONFIG_GLOBAL", global)
	t.Setenv("GIT_AUTHOR_NAME", "Inherited Wrong Author")
	t.Setenv("GIT_AUTHOR_EMAIL", "wrong@example.com")
	for _, identity := range []struct{ name, email string }{{"Personal", "personal@example.com"}, {"Work", "work@example.com"}} {
		path := initRepo(t)
		testGit(t, path, "config", "author.name", "Local Wrong Author")
		testGit(t, path, "config", "author.email", "local-wrong@example.com")
		testGit(t, path, "config", "committer.name", "Local Wrong Committer")
		file := "中文 [a].txt"
		if err := os.WriteFile(filepath.Join(path, file), []byte("hello\n"), 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(path, "中文 a.txt"), []byte("leave unstaged\n"), 0600); err != nil {
			t.Fatal(err)
		}
		if err := r.Stage(ctx, path, file, true); err != nil {
			t.Fatal(err)
		}
		if got := testGit(t, path, "diff", "--cached", "--name-only"); got != file {
			t.Fatalf("literal staging: %q", got)
		}
		if err := r.Commit(ctx, path, "initial", identity.name, identity.email); err != nil {
			t.Fatal(err)
		}
		got := testGit(t, path, "log", "-1", "--format=%an|%ae|%cn|%ce")
		want := identity.name + "|" + identity.email + "|" + identity.name + "|" + identity.email
		if got != want {
			t.Fatalf("identity: %q != %q", got, want)
		}
		s, err := r.Status(ctx, path)
		if err != nil {
			t.Fatal(err)
		}
		if s.Branch != "main" || len(s.Files) != 1 || s.Files[0].Path != "中文 a.txt" {
			t.Fatalf("status %+v", s)
		}
	}
	content, _ := os.ReadFile(global)
	if !strings.Contains(string(content), "global@example.com") {
		t.Fatal("global config changed")
	}
}
func TestUnstageUnbornAndRename(t *testing.T) {
	r := Runner{}
	ctx := context.Background()
	path := initRepo(t)
	file := "first.txt"
	_ = os.WriteFile(filepath.Join(path, file), []byte("first"), 0600)
	if err := r.Stage(ctx, path, file, true); err != nil {
		t.Fatal(err)
	}
	if err := r.Stage(ctx, path, file, false); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(path, file)); err != nil {
		t.Fatal("unstage removed working file")
	}
	if err := r.Stage(ctx, path, file, true); err != nil {
		t.Fatal(err)
	}
	if err := r.Commit(ctx, path, "first", "Test", "test@example.com"); err != nil {
		t.Fatal(err)
	}
	testGit(t, path, "mv", file, "second file.txt")
	s, err := r.Status(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	if len(s.Files) != 1 || s.Files[0].Path != "second file.txt" || s.Files[0].OriginalPath != file {
		t.Fatalf("rename status %+v", s.Files)
	}
	if err = r.Stage(ctx, path, "second file.txt", false); err != nil {
		t.Fatal(err)
	}
	if staged := testGit(t, path, "diff", "--cached", "--name-only"); staged != "" {
		t.Fatalf("rename only partially unstaged: %s", staged)
	}
}
func TestDirtySwitchPreservesFiles(t *testing.T) {
	path := initRepo(t)
	r := Runner{}
	ctx := context.Background()
	_ = os.WriteFile(filepath.Join(path, "file.txt"), []byte("main"), 0600)
	_ = r.Stage(ctx, path, "file.txt", true)
	_ = r.Commit(ctx, path, "main", "Test", "test@example.com")
	_ = r.Switch(ctx, path, "feature", true)
	_ = os.WriteFile(filepath.Join(path, "file.txt"), []byte("feature"), 0600)
	_ = r.Stage(ctx, path, "file.txt", true)
	_ = r.Commit(ctx, path, "feature", "Test", "test@example.com")
	_ = r.Switch(ctx, path, "main", false)
	_ = os.WriteFile(filepath.Join(path, "file.txt"), []byte("uncommitted"), 0600)
	if err := r.Switch(ctx, path, "feature", false); err == nil {
		t.Fatal("expected dirty switch failure")
	}
	b, _ := os.ReadFile(filepath.Join(path, "file.txt"))
	if string(b) != "uncommitted" {
		t.Fatal("working changes lost")
	}
}
func TestCredentialIsolationWithRealGitHelper(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range []struct{ login, token string }{{"personal", "test-personal-secret"}, {"work", "test-work-secret"}} {
		c, err := StartCredentials(ctx, "org/project", a.login, a.token)
		if err != nil {
			t.Fatal(err)
		}
		cmd := exec.Command("git", "-c", "credential.helper=", "-c", "credential.helper=!"+quoteShell(exe)+" --credential-helper", "-c", "credential.useHttpPath=true", "credential", "fill")
		cmd.Env = CleanEnv("BERTH_CREDENTIAL_ENDPOINT="+c.Endpoint, "BERTH_CREDENTIAL_NONCE="+c.Nonce)
		cmd.Stdin = strings.NewReader("protocol=https\nhost=github.com\npath=org/project.git\n\n")
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("real git credential helper: %v %s", err, out)
		}
		if !strings.Contains(string(out), "username="+a.login) || !strings.Contains(string(out), "password="+a.token) {
			t.Fatal("incorrect account credential")
		}
		for _, env := range cmd.Env {
			if strings.Contains(env, a.token) {
				t.Fatal("token leaked into environment")
			}
		}
		for _, test := range []struct{ path, nonce string }{{"org/other.git", c.Nonce}, {"org/project.git", "wrong"}} {
			data, _ := json.Marshal(CredentialRequest{"https", "github.com", test.path})
			req, _ := http.NewRequest("POST", c.Endpoint, bytes.NewReader(data))
			req.Header.Set("Authorization", "Bearer "+test.nonce)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			b, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			if resp.StatusCode != 403 || strings.Contains(string(b), a.token) {
				t.Fatal("credential scope bypass")
			}
		}
		c.Close()
	}
}
func TestRejectUnsafeTargetsAndPaths(t *testing.T) {
	for _, url := range []string{"http://github.com/a/b", "https://evil.example/a/b", "https://secret@github.com/a/b.git", "https://github.com:443/a/b.git", "https://github.com/a/../b", "https://github.com/a/b?token=secret", "git@github.com:a/b.git"} {
		if _, err := GitHubTarget(url); err == nil {
			t.Errorf("accepted %s", url)
		}
	}
	for _, path := range []string{"../file", ".git/config", "-x", ""} {
		if err := ValidFile(path); err == nil {
			t.Errorf("accepted %q", path)
		}
	}
}
func TestSSHImportDoesNotTreatUsernameAsToken(t *testing.T) {
	path := initRepo(t)
	testGit(t, path, "remote", "add", "origin", "ssh://git@github.com/org/project.git")
	remotes, err := (Runner{}).Remotes(context.Background(), path)
	if err != nil || len(remotes) != 1 {
		t.Fatalf("SSH import: %v %+v", err, remotes)
	}
	testGit(t, path, "remote", "set-url", "origin", "https://token@github.com/org/project.git")
	if _, err = (Runner{}).Remotes(context.Background(), path); err == nil {
		t.Fatal("accepted remote credentials")
	}
}
func TestLargeDiffIsReportedInsteadOfSilentlyTruncated(t *testing.T) {
	path := initRepo(t)
	r := Runner{}
	ctx := context.Background()
	file := filepath.Join(path, "large.txt")
	if err := os.WriteFile(file, []byte("initial\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := r.Stage(ctx, path, "large.txt", true); err != nil {
		t.Fatal(err)
	}
	if err := r.Commit(ctx, path, "initial", "Test", "test@example.com"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte(strings.Repeat("new line\n", 600000)), 0600); err != nil {
		t.Fatal(err)
	}
	out, err := r.Diff(ctx, path, "large.txt", false)
	if err == nil || !strings.HasPrefix(err.Error(), "OUTPUT_LIMIT:") || out != "" {
		t.Fatalf("large output was returned as complete: bytes=%d err=%v", len(out), err)
	}
}
func TestGitVersionDiagnosticsRejectWrongOrOldExecutable(t *testing.T) {
	exe, _ := os.Executable()
	t.Setenv("BERTH_FAKE_GIT", "1")
	for _, tc := range []struct{ version, code string }{{"PowerShell 7.4", "GIT_INVALID"}, {"git version 2.20.0", "GIT_TOO_OLD"}, {"git version unknown", "GIT_INVALID"}} {
		t.Setenv("BERTH_TEST_VERSION", tc.version)
		if _, err := (Runner{Binary: exe}).Version(context.Background()); err == nil || !strings.HasPrefix(err.Error(), tc.code+":") {
			t.Fatalf("version %q: %v", tc.version, err)
		}
	}
	t.Setenv("BERTH_TEST_VERSION", "git version 2.49.0.windows.1")
	if version, err := (Runner{Binary: exe}).Version(context.Background()); err != nil || version != "git version 2.49.0.windows.1" {
		t.Fatalf("valid Git rejected: %s %v", version, err)
	}
}
func TestCancelledCommand(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := Runner{}.Run(ctx, "", nil, nil, "status")
	if err != context.Canceled {
		t.Fatalf("cancel: %v", err)
	}
}
func TestProgressDoesNotForwardSecrets(t *testing.T) {
	var messages []string
	var b cappedBuffer
	w := progressWriter{buffer: &b, callback: func(s string) { messages = append(messages, s) }}
	_, _ = w.Write([]byte("remote: secret-token\nReceiving objects: 42% (42/100) secret-token\r"))
	if len(messages) != 1 || messages[0] != "接收对象 42%" {
		t.Fatalf("progress %+v", messages)
	}
}
func TestIPCClosesOnCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	c, err := StartCredentials(ctx, "a/b", "a", "secret")
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	select {
	case <-c.done:
	case <-time.After(time.Second):
		t.Fatal("IPC did not close")
	}
}
func TestNetworkUsesExplicitNonForcedRefspec(t *testing.T) {
	exe, _ := os.Executable()
	capture := filepath.Join(t.TempDir(), "args.json")
	t.Setenv("BERTH_FAKE_GIT", "1")
	t.Setenv("BERTH_CAPTURE", capture)
	r := Runner{Binary: exe}
	auth := Auth{URL: "https://github.com/org/project.git", Login: "work", Token: "not-a-real-token", Helper: exe}
	for _, operation := range []string{"push", "pull"} {
		if err := r.Network(context.Background(), "", operation, "origin", auth); err != nil {
			t.Fatal(err)
		}
		b, err := os.ReadFile(capture)
		if err != nil {
			t.Fatal(err)
		}
		var args []string
		_ = json.Unmarshal(b, &args)
		joined := strings.Join(args, " ")
		if operation == "push" {
			if !strings.Contains(joined, "HEAD:refs/heads/main") || strings.Contains(joined, "force") || strings.Contains(joined, "+") {
				t.Fatalf("unsafe push arguments %q", args)
			}
		} else if !strings.Contains(joined, "--ff-only --no-rebase origin main") {
			t.Fatalf("unsafe pull arguments %q", args)
		}
	}
}
func TestDivergedPullAndPushPreserveLocalHistory(t *testing.T) {
	ctx := context.Background()
	r := Runner{}
	left := initRepo(t)
	bare := filepath.Join(t.TempDir(), "remote.git")
	testGit(t, left, "init", "--bare", bare)
	_ = os.WriteFile(filepath.Join(left, "initial.txt"), []byte("initial"), 0600)
	if err := r.Stage(ctx, left, "initial.txt", true); err != nil {
		t.Fatal(err)
	}
	if err := r.Commit(ctx, left, "initial", "Test", "test@example.com"); err != nil {
		t.Fatal(err)
	}
	testGit(t, left, "remote", "add", "origin", bare)
	testGit(t, left, "push", "--set-upstream", "origin", "main")
	right := filepath.Join(t.TempDir(), "right")
	testGit(t, left, "clone", "--branch", "main", bare, right)
	for _, entry := range []struct{ path, file string }{{left, "left.txt"}, {right, "right.txt"}} {
		_ = os.WriteFile(filepath.Join(entry.path, entry.file), []byte(entry.file), 0600)
		if err := r.Stage(ctx, entry.path, entry.file, true); err != nil {
			t.Fatal(err)
		}
		if err := r.Commit(ctx, entry.path, entry.file, "Test", "test@example.com"); err != nil {
			t.Fatal(err)
		}
	}
	testGit(t, right, "push", "origin", "main")
	before := testGit(t, left, "rev-parse", "HEAD")
	for _, args := range [][]string{{"pull", "--ff-only", "--no-rebase", "origin", "main"}, {"push", "origin", "HEAD:refs/heads/main"}} {
		if _, err := r.Run(ctx, left, nil, []string{"protocol.file.allow=always"}, args...); err == nil {
			t.Fatalf("diverged operation succeeded: %v", args)
		}
	}
	if after := testGit(t, left, "rev-parse", "HEAD"); after != before {
		t.Fatal("divergence changed local history")
	}
	if _, err := os.Stat(filepath.Join(left, "left.txt")); err != nil {
		t.Fatal("local file lost")
	}
}

func TestClassifyWorkflowScopeRejection(t *testing.T) {
	err := classify("remote: refusing to allow an OAuth App to create or update workflow `.github/workflows/ci.yml` without `workflow` scope")
	appErr, ok := err.(*model.AppError)
	if !ok || appErr.Code != "WORKFLOW_SCOPE" {
		t.Fatalf("unexpected error: %v", err)
	}
}
