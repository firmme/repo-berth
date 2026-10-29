package gitexec

import (
	"context"
	"os/exec"
	"strings"
	"time"
)

// Read only protected safe.directory values, never user identity, URL rewrites,
// credential helpers or hooks. This command reads configuration and never writes it.
func (r Runner) safeDirectories(ctx context.Context) []string {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	binary := r.Binary
	if binary == "" {
		binary = "git"
	}
	env := []string{}
	for _, v := range CleanEnv() {
		key, _, _ := strings.Cut(v, "=")
		if !strings.EqualFold(key, "GIT_CONFIG_GLOBAL") && !strings.EqualFold(key, "GIT_CONFIG_NOSYSTEM") {
			env = append(env, v)
		}
	}
	result := []string{}
	for _, scope := range []string{"--system", "--global"} {
		cmd := exec.CommandContext(ctx, binary, "config", scope, "--includes", "--null", "--get-all", "safe.directory")
		cmd.Env = env
		hideWindow(cmd)
		cmd.WaitDelay = time.Second
		var output cappedBuffer
		cmd.Stdout = &output
		if err := cmd.Run(); err != nil || output.Truncated() {
			continue
		}
		raw := output.String()
		if strings.HasSuffix(raw, "\x00") {
			result = append(result, strings.Split(strings.TrimSuffix(raw, "\x00"), "\x00")...)
		}
	}
	return result
}
