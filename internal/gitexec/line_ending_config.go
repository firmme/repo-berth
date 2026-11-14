package gitexec

import (
	"context"
	"os/exec"
	"strings"
	"time"
)

// Preserve Git's effective EOL policy while keeping identities, credential
// helpers, URL rewrites and other protected configuration isolated. Query all
// scopes together so local config and conditional includes retain precedence.
// No repository/global configuration is written and no file bytes are changed.
func (r Runner) lineEndingConfig(ctx context.Context, dir string) []string {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	binary := r.Binary
	if binary == "" {
		binary = "git"
	}
	env := []string{}
	for _, entry := range CleanEnv() {
		key, _, _ := strings.Cut(entry, "=")
		if !strings.EqualFold(key, "GIT_CONFIG_GLOBAL") && !strings.EqualFold(key, "GIT_CONFIG_NOSYSTEM") {
			env = append(env, entry)
		}
	}
	args := []string{}
	for _, path := range r.TrustedDirectories {
		args = append(args, "-c", "safe.directory="+path)
	}
	args = append(args, "config", "--includes", "--null", "--get-regexp", `^core\.(autocrlf|eol|safecrlf)$`)
	cmd := exec.CommandContext(ctx, binary, args...)
	cmd.Dir = dir
	cmd.Env = env
	cmd.WaitDelay = time.Second
	hideWindow(cmd)
	var output cappedBuffer
	cmd.Stdout = &output
	if err := cmd.Run(); err != nil || output.Truncated() {
		return nil
	}
	result := []string{}
	for _, entry := range strings.Split(output.String(), "\x00") {
		key, value, ok := strings.Cut(entry, "\n")
		if !ok {
			// A valueless boolean entry means true in Git configuration.
			key, value = entry, "true"
		}
		switch strings.ToLower(key) {
		case "core.autocrlf", "core.eol", "core.safecrlf":
			result = append(result, key+"="+value)
		}
	}
	return result
}
