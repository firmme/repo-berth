package gitexec

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func recoveryFixture(t *testing.T) (string, Runner, string) {
	t.Helper()
	root := initRepo(t)
	testGit(t, root, "config", "core.autocrlf", "false")
	testGit(t, root, "config", "core.eol", "lf")
	r := Runner{}
	for name, text := range map[string]string{"one.txt": "original\n", "two.txt": "second\n", ".gitignore": "*.ignored\n"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	testGit(t, root, "add", ".")
	testGit(t, root, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "base")
	return root, r, testGit(t, root, "rev-parse", "HEAD")
}

func applyTestRecovery(t *testing.T, r Runner, root string, req RecoveryRequest) RecoveryPlan {
	t.Helper()
	plan, err := r.PreviewRecovery(context.Background(), root, req)
	if err != nil {
		t.Fatal(err)
	}
	if err = r.ApplyRecovery(context.Background(), root, req, plan.Fingerprint); err != nil {
		t.Fatal(err)
	}
	return plan
}

func TestDiscardSelectedChangesRestoresHeadAndLeavesOtherFiles(t *testing.T) {
	root, r, head := recoveryFixture(t)
	os.WriteFile(filepath.Join(root, "one.txt"), []byte("staged\n"), 0600)
	testGit(t, root, "add", "one.txt")
	os.WriteFile(filepath.Join(root, "one.txt"), []byte("later\n"), 0600)
	os.WriteFile(filepath.Join(root, "two.txt"), []byte("keep\n"), 0600)
	applyTestRecovery(t, r, root, RecoveryRequest{Kind: "discard", Paths: []string{"one.txt"}})
	bytes, _ := os.ReadFile(filepath.Join(root, "one.txt"))
	if string(bytes) != "original\n" {
		t.Fatal("did not restore committed version")
	}
	bytes, _ = os.ReadFile(filepath.Join(root, "two.txt"))
	if string(bytes) != "keep\n" {
		t.Fatal("discard changed unrelated file")
	}
	if testGit(t, root, "rev-parse", "HEAD") != head || testGit(t, root, "diff", "--cached") != "" {
		t.Fatal("changed history or kept discarded staged content")
	}
}

func TestDiscardAllPreservesUntrackedByDefaultAndNeverCleansIgnored(t *testing.T) {
	root, r, _ := recoveryFixture(t)
	for _, name := range []string{"one.txt", "new.txt", "cache.ignored"} {
		os.WriteFile(filepath.Join(root, name), []byte("changed\n"), 0600)
	}
	applyTestRecovery(t, r, root, RecoveryRequest{Kind: "discard", All: true})
	if _, err := os.Stat(filepath.Join(root, "new.txt")); err != nil {
		t.Fatal("default discard removed untracked file")
	}
	applyTestRecovery(t, r, root, RecoveryRequest{Kind: "discard", All: true, IncludeUntracked: true})
	if _, err := os.Stat(filepath.Join(root, "new.txt")); !os.IsNotExist(err) {
		t.Fatal("explicit untracked removal failed")
	}
	if _, err := os.Stat(filepath.Join(root, "cache.ignored")); err != nil {
		t.Fatal("ignored file was removed")
	}
}

func TestDiscardRenamesAndStagedAdditionsWithLiteralPaths(t *testing.T) {
	root, r, _ := recoveryFixture(t)
	testGit(t, root, "mv", "one.txt", "renamed.txt")
	name := "[literal].txt"
	os.WriteFile(filepath.Join(root, name), []byte("new\n"), 0600)
	testGit(t, root, "add", "--", name)
	applyTestRecovery(t, r, root, RecoveryRequest{Kind: "discard", Paths: []string{"renamed.txt", name}})
	if _, err := os.Stat(filepath.Join(root, "one.txt")); err != nil {
		t.Fatal("rename source not restored")
	}
	for _, p := range []string{"renamed.txt", name} {
		if _, err := os.Stat(filepath.Join(root, p)); !os.IsNotExist(err) {
			t.Fatal("new path not removed")
		}
	}
}

func TestDiscardBeforeFirstCommitAndStaleConfirmation(t *testing.T) {
	root := initRepo(t)
	r := Runner{}
	file := filepath.Join(root, "new.txt")
	os.WriteFile(file, []byte("new\n"), 0600)
	testGit(t, root, "add", "new.txt")
	req := RecoveryRequest{Kind: "discard", All: true}
	plan, err := r.PreviewRecovery(context.Background(), root, req)
	if err != nil {
		t.Fatal(err)
	}
	os.WriteFile(file, []byte("newer\n"), 0600)
	if err = r.ApplyRecovery(context.Background(), root, req, plan.Fingerprint); err == nil || !strings.Contains(err.Error(), "RECOVERY_CHANGED") {
		t.Fatalf("stale confirmation accepted: %v", err)
	}
	if bytes, _ := os.ReadFile(file); string(bytes) != "newer\n" {
		t.Fatal("stale confirmation changed content")
	}
	applyTestRecovery(t, r, root, req)
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Fatal("unborn added file not removed")
	}
}

func TestResetModesPreserveTheirDocumentedIndexAndWorktreeSemantics(t *testing.T) {
	for _, mode := range []string{"soft", "mixed", "hard"} {
		t.Run(mode, func(t *testing.T) {
			root, r, base := recoveryFixture(t)
			os.WriteFile(filepath.Join(root, "one.txt"), []byte("committed second\n"), 0600)
			testGit(t, root, "add", "one.txt")
			testGit(t, root, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "second")
			os.WriteFile(filepath.Join(root, "two.txt"), []byte("staged\n"), 0600)
			testGit(t, root, "add", "two.txt")
			os.WriteFile(filepath.Join(root, "two.txt"), []byte("working\n"), 0600)
			os.WriteFile(filepath.Join(root, "untracked.txt"), []byte("keep\n"), 0600)
			plan := applyTestRecovery(t, r, root, RecoveryRequest{Kind: "reset", Mode: mode, Target: base})
			if plan.Commits != 1 || testGit(t, root, "rev-parse", "HEAD") != base {
				t.Fatal("incorrect history reset")
			}
			work, _ := os.ReadFile(filepath.Join(root, "two.txt"))
			index := testGit(t, root, "show", ":two.txt")
			if mode == "hard" {
				if string(work) != "second\n" || index != "second" {
					t.Fatal("hard reset did not restore files and index")
				}
			} else {
				if string(work) != "working\n" {
					t.Fatal("non-hard reset changed worktree")
				}
				if mode == "soft" && index != "staged" || mode == "mixed" && index != "second" {
					t.Fatal("incorrect index after reset")
				}
			}
			if _, err := os.Stat(filepath.Join(root, "untracked.txt")); err != nil {
				t.Fatal("unrelated untracked file lost")
			}
		})
	}
}

func TestHardResetRefusesToOverwriteIgnoredOrUntrackedFiles(t *testing.T) {
	for _, name := range []string{"target.txt", "target.ignored"} {
		t.Run(name, func(t *testing.T) {
			root, r, base := recoveryFixture(t)
			os.WriteFile(filepath.Join(root, name), []byte("committed\n"), 0600)
			testGit(t, root, "add", "-f", "--", name)
			testGit(t, root, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "target")
			target := testGit(t, root, "rev-parse", "HEAD")
			testGit(t, root, "reset", "--hard", base)
			os.WriteFile(filepath.Join(root, name), []byte("keep me\n"), 0600)
			_, err := r.PreviewRecovery(context.Background(), root, RecoveryRequest{Kind: "reset", Mode: "hard", Target: target})
			if err == nil || !strings.Contains(err.Error(), "UNTRACKED_CONFLICT") {
				t.Fatalf("overwriting reset accepted: %v", err)
			}
			bytes, _ := os.ReadFile(filepath.Join(root, name))
			if string(bytes) != "keep me\n" || testGit(t, root, "rev-parse", "HEAD") != base {
				t.Fatal("preview changed files or HEAD")
			}
		})
	}
}

func TestHardResetProtectsCaseInsensitiveWindowsPaths(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("case-insensitive Windows filesystem protection")
	}
	root, r, base := recoveryFixture(t)
	os.WriteFile(filepath.Join(root, "target.txt"), []byte("committed\n"), 0600)
	testGit(t, root, "add", "target.txt")
	testGit(t, root, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "target")
	target := testGit(t, root, "rev-parse", "HEAD")
	testGit(t, root, "reset", "--hard", base)
	os.WriteFile(filepath.Join(root, "TARGET.TXT"), []byte("precious new file\n"), 0600)
	if _, err := r.PreviewRecovery(context.Background(), root, RecoveryRequest{Kind: "reset", Mode: "hard", Target: target}); err == nil || !strings.Contains(err.Error(), "UNTRACKED_CONFLICT") {
		t.Fatalf("case-aliasing path overwrite allowed: %v", err)
	}
}

func TestRecoveryMutationPathRejectsMetadataAndDirectoryTargets(t *testing.T) {
	root := t.TempDir()
	os.Mkdir(filepath.Join(root, "folder"), 0700)
	workspace, err := os.OpenRoot(root)
	if err != nil {
		t.Fatal(err)
	}
	defer workspace.Close()
	for _, name := range []string{"../outside", ".git/config", ".GIT/config", "folder", "folder/../outside"} {
		if _, err := mutationPath(workspace, name); err == nil {
			t.Fatalf("unsafe file target accepted: %s", name)
		}
	}
}

func TestDiscardProtectsLocalFilesAtRestoreDestinations(t *testing.T) {
	root, r, _ := recoveryFixture(t)
	testGit(t, root, "mv", "one.txt", "renamed.txt")
	original := filepath.Join(root, "one.txt")
	fixture := []byte("new local contents\n")
	if err := os.WriteFile(original, fixture, 0600); err != nil {
		t.Fatal(err)
	}
	for _, ignored := range []bool{false, true} {
		if ignored {
			if err := os.WriteFile(filepath.Join(root, ".git", "info", "exclude"), []byte("/one.txt\n"), 0600); err != nil {
				t.Fatal(err)
			}
		}
		for _, include := range []bool{false, true} {
			_, err := r.PreviewRecovery(context.Background(), root, RecoveryRequest{
				Kind: "discard", Paths: []string{"renamed.txt"}, IncludeUntracked: include,
			})
			if err == nil || !strings.Contains(err.Error(), "UNTRACKED_CONFLICT") {
				t.Fatalf("ignored=%t include=%t: %v", ignored, include, err)
			}
		}
	}
	if data, err := os.ReadFile(original); err != nil || string(data) != string(fixture) {
		t.Fatalf("local file changed: %q (%v)", data, err)
	}
}
