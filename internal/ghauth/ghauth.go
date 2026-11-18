// Package ghauth invokes the installed official GitHub CLI. It never borrows
// the CLI's OAuth client ID or changes Git's credential helper configuration.
package ghauth

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"

	"repo-berth/internal/model"
)

type Account struct {
	Login  string `json:"login"`
	Active bool   `json:"active"`
	State  string `json:"state"`
}

type Client struct{}

func environment() []string {
	env := []string{}
	for _, value := range os.Environ() {
		key, _, _ := strings.Cut(value, "=")
		switch strings.ToUpper(key) {
		case "GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN", "GH_DEBUG", "GH_PROMPT_DISABLED", "GH_NO_UPDATE_NOTIFIER", "NO_COLOR":
			continue
		}
		env = append(env, value)
	}
	return append(env, "GH_PROMPT_DISABLED=1", "GH_NO_UPDATE_NOTIFIER=1", "NO_COLOR=1")
}

func run(ctx context.Context, output io.Writer, args ...string) error {
	binary, err := exec.LookPath("gh")
	if err != nil {
		return model.Err("CLI_MISSING", "未找到官方 GitHub CLI；请安装后重启 Repo Berth，再使用此登录方式")
	}
	cmd := exec.CommandContext(ctx, binary, args...)
	cmd.Env = environment()
	cmd.Stdin = strings.NewReader("\n")
	cmd.Stdout = output
	// CLI errors and diagnostic output may contain credentials. Never expose them.
	cmd.Stderr = io.Discard
	cmd.WaitDelay = 3 * time.Second
	hideWindow(cmd)
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return model.Err("CLI_AUTH_FAILED", "GitHub CLI 操作未完成；请检查网络、CLI 版本及账号登录状态后重试")
	}
	return nil
}

func (*Client) Accounts(ctx context.Context) ([]Account, error) {
	var output limitedBuffer
	err := run(ctx, &output, "auth", "status", "--hostname", "github.com", "--json", "hosts", "--jq", `.hosts["github.com"] // []`)
	if err != nil {
		return nil, err
	}
	var accounts []Account
	if json.Unmarshal(output.Bytes(), &accounts) != nil {
		return nil, model.Err("CLI_RESPONSE", "无法读取 GitHub CLI 账号，请升级官方 GitHub CLI 后重试")
	}
	return accounts, nil
}

func (*Client) Token(ctx context.Context, login string) (string, error) {
	var output limitedBuffer
	if err := run(ctx, &output, "auth", "token", "--hostname", "github.com", "--user", login); err != nil {
		return "", err
	}
	token := strings.TrimSpace(output.String())
	if token == "" || len(token) > 4096 || strings.ContainsAny(token, " \t\r\n\x00") {
		return "", model.Err("CLI_AUTH_FAILED", "GitHub CLI 未返回有效的账号凭据，请重新登录")
	}
	return token, nil
}

var deviceCode = regexp.MustCompile(`\b[A-Z0-9]{4}-[A-Z0-9]{4}\b`)

// Login only publishes the short user verification code, never raw CLI output.
func (*Client) Login(ctx context.Context, onCode func(string)) error {
	binary, err := exec.LookPath("gh")
	if err != nil {
		return model.Err("CLI_MISSING", "未找到官方 GitHub CLI；请安装后重启 Repo Berth")
	}
	cmd := exec.CommandContext(ctx, binary, "auth", "login", "--web", "--hostname", "github.com", "--git-protocol", "https", "--scopes", "repo,workflow", "--skip-ssh-key")
	cmd.Env = environment()
	cmd.Stdin = strings.NewReader("\n")
	progress := &codeWriter{onCode: onCode}
	cmd.Stdout, cmd.Stderr = progress, progress
	cmd.WaitDelay = 3 * time.Second
	hideWindow(cmd)
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return model.Err("CLI_AUTH_FAILED", "GitHub CLI 登录未完成，请检查网络并在浏览器中确认账号后重试")
	}
	return nil
}

type limitedBuffer struct{ buffer bytes.Buffer }

func (b *limitedBuffer) Bytes() []byte  { return b.buffer.Bytes() }
func (b *limitedBuffer) String() string { return b.buffer.String() }

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if b.buffer.Len()+len(p) > 1<<20 {
		return 0, model.Err("CLI_RESPONSE", "GitHub CLI 响应超出限制")
	}
	return b.buffer.Write(p)
}

type codeWriter struct {
	mu     sync.Mutex
	text   string
	sent   bool
	onCode func(string)
}

func (w *codeWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.sent {
		return len(p), nil
	}
	w.text += string(p)
	if code := deviceCode.FindString(w.text); code != "" {
		w.sent = true
		w.onCode(code)
		w.text = ""
	} else if len(w.text) > 1024 {
		w.text = w.text[len(w.text)-1024:]
	}
	return len(p), nil
}
