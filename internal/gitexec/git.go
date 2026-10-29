package gitexec

import (
	"bytes"
	"context"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"repo-berth/internal/model"
	"runtime"
	"strings"
	"sync"
	"time"
)

type Runner struct {
	Binary             string
	Progress           func(string)
	TrustedDirectories []string
}
type Auth struct {
	URL    string
	Login  string
	Token  string
	Helper string
}
type FileStatus struct {
	Path         string `json:"path"`
	OriginalPath string `json:"originalPath"`
	Index        string `json:"index"`
	Worktree     string `json:"worktree"`
}
type Status struct {
	Branch   string       `json:"branch"`
	Upstream string       `json:"upstream"`
	Ahead    int          `json:"ahead"`
	Behind   int          `json:"behind"`
	Files    []FileStatus `json:"files"`
	Remotes  []Remote     `json:"remotes"`
	Detached bool         `json:"detached"`
}
type Remote struct {
	Name    string `json:"name"`
	URL     string `json:"url"`
	PushURL string `json:"pushUrl"`
}
type Commit struct {
	Hash    string `json:"hash"`
	Author  string `json:"author"`
	Email   string `json:"email"`
	Date    string `json:"date"`
	Subject string `json:"subject"`
}
type Branch struct {
	Name    string `json:"name"`
	Current bool   `json:"current"`
}

type cappedBuffer struct {
	mu        sync.Mutex
	b         bytes.Buffer
	truncated bool
}
type progressWriter struct {
	buffer   *cappedBuffer
	pending  string
	callback func(string)
}

var percentage = regexp.MustCompile(`\b([0-9]{1,3})%`)

func (w *progressWriter) Write(p []byte) (int, error) {
	n, err := w.buffer.Write(p)
	if w.callback == nil {
		return n, err
	}
	w.pending += string(p)
	for {
		index := strings.IndexAny(w.pending, "\r\n")
		if index < 0 {
			break
		}
		line := w.pending[:index]
		w.pending = w.pending[index+1:]
		match := percentage.FindString(line)
		if match == "" {
			continue
		}
		for _, phase := range []struct{ key, label string }{{"Receiving objects", "接收对象"}, {"Resolving deltas", "解析差异"}, {"Compressing objects", "压缩对象"}, {"Writing objects", "写入对象"}, {"Updating files", "更新文件"}, {"Counting objects", "统计对象"}} {
			if strings.Contains(line, phase.key) {
				w.callback(phase.label + " " + match)
				break
			}
		}
	}
	if len(w.pending) > 4096 {
		w.pending = ""
	}
	return n, err
}

func (b *cappedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	n := len(p)
	remaining := (4 << 20) - b.b.Len()
	if n > remaining {
		b.truncated = true
	}
	if remaining > 0 {
		_, _ = b.b.Write(p[:min(remaining, n)])
	}
	return n, nil
}
func (b *cappedBuffer) String() string  { b.mu.Lock(); defer b.mu.Unlock(); return b.b.String() }
func (b *cappedBuffer) Truncated() bool { b.mu.Lock(); defer b.mu.Unlock(); return b.truncated }
func CleanEnv(extra ...string) []string {
	env := []string{}
	for _, v := range os.Environ() {
		key, _, _ := strings.Cut(v, "=")
		k := strings.ToUpper(key)
		if strings.HasPrefix(k, "GIT_") || strings.HasPrefix(k, "BERTH_CREDENTIAL_") || strings.HasPrefix(k, "SSH_") {
			continue
		}
		env = append(env, v)
	}
	return append(env, append([]string{"GIT_TERMINAL_PROMPT=0", "GIT_CONFIG_GLOBAL=" + os.DevNull, "GIT_CONFIG_NOSYSTEM=1", "GIT_PAGER=cat", "GIT_LITERAL_PATHSPECS=1", "GIT_OPTIONAL_LOCKS=0", "GIT_LFS_SKIP_SMUDGE=1", "LC_ALL=C"}, extra...)...)
}
func quoteShell(s string) string {
	return "'" + strings.ReplaceAll(filepath.ToSlash(s), "'", "'\\''") + "'"
}
func (r Runner) Run(ctx context.Context, dir string, auth *Auth, config []string, args ...string) (string, error) {
	base := []string{"-c", "core.quotepath=false", "-c", "color.ui=false", "-c", "credential.helper=", "-c", "http.followRedirects=false", "-c", "protocol.file.allow=never", "-c", "protocol.ext.allow=never", "-c", "core.fsmonitor=false"}
	env := CleanEnv()
	for _, path := range r.TrustedDirectories {
		base = append(base, "-c", "safe.directory="+filepath.ToSlash(path))
	}
	if auth != nil {
		target, err := GitHubTarget(auth.URL)
		if err != nil {
			return "", err
		}
		credCtx, cancel := context.WithCancel(ctx)
		defer cancel()
		c, err := StartCredentials(credCtx, target, auth.Login, auth.Token)
		if err != nil {
			return "", model.Err("CREDENTIAL_IPC", "无法启动凭据通道")
		}
		defer c.Close()
		base = append(base, "-c", "credential.useHttpPath=true", "-c", "credential.helper=!"+quoteShell(auth.Helper)+" --credential-helper", "-c", "credential.interactive=false")
		env = append(env, "BERTH_CREDENTIAL_ENDPOINT="+c.Endpoint, "BERTH_CREDENTIAL_NONCE="+c.Nonce)
	}
	for _, c := range config {
		base = append(base, "-c", c)
	}
	base = append(base, args...)
	binary := r.Binary
	if binary == "" {
		binary = "git"
	}
	for attempt := 0; attempt < 2; attempt++ {
		cmd := exec.CommandContext(ctx, binary, base...)
		cmd.Dir = dir
		cmd.Env = env
		cmd.WaitDelay = 3 * time.Second
		hideWindow(cmd)
		var stdout, stderr cappedBuffer
		cmd.Stdout = &stdout
		cmd.Stderr = &progressWriter{buffer: &stderr, callback: r.Progress}
		err := cmd.Run()
		out := stdout.String()
		if auth != nil {
			out = strings.ReplaceAll(out, auth.Token, "[redacted]")
		}
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		if err != nil {
			if attempt == 0 && strings.Contains(strings.ToLower(stderr.String()), "detected dubious ownership") {
				trusted := r.safeDirectories(ctx)
				if ctx.Err() != nil {
					return "", ctx.Err()
				}
				if len(trusted) > 0 {
					flags := []string{"-c", "safe.directory="}
					for _, path := range trusted {
						flags = append(flags, "-c", "safe.directory="+path)
					}
					base = append(flags, base...)
					continue
				}
			}
			return "", classify(stderr.String())
		}
		if stdout.Truncated() {
			return "", model.Err("OUTPUT_LIMIT", "Git 输出超过 4 MiB，无法完整显示；请缩小文件范围或在外部工具中查看")
		}
		return out, nil
	}
	return "", model.Err("DUBIOUS_OWNERSHIP", "Git 目录所有者检查失败，请重新选择本地仓库")
}
func classify(s string) error {
	lower := strings.ToLower(s)
	switch {
	case strings.Contains(lower, "detected dubious ownership"):
		return model.Err("DUBIOUS_OWNERSHIP", "Git 目录所有者检查失败，请重新选择本地仓库")
	case strings.Contains(lower, "authentication failed") || strings.Contains(lower, "could not read username"):
		return model.Err("AUTH_REQUIRED", "凭据被拒绝，请重新授权并确认仓库绑定账号")
	case strings.Contains(lower, "403") || strings.Contains(lower, "permission") || strings.Contains(lower, "repository not found"):
		return model.Err("PERMISSION", "无法访问仓库，请检查账号权限、组织 SSO 或仓库地址")
	case strings.Contains(lower, "fast-forward") || strings.Contains(lower, "non-fast-forward"):
		return model.Err("DIVERGED", "分支已分叉或远程存在新提交，请在外部工具中处理后重试")
	case strings.Contains(lower, "overwritten") || strings.Contains(lower, "unmerged") || strings.Contains(lower, "resolve your current index"):
		return model.Err("WORKTREE_DIRTY", "工作区有未处理的修改或冲突，请先提交或在外部工具中处理")
	case strings.Contains(lower, "could not resolve") || strings.Contains(lower, "unable to access") || strings.Contains(lower, "connection"):
		return model.Err("NETWORK", "Git 网络连接失败，请检查网络或代理设置")
	case strings.Contains(lower, "not a git repository"):
		return model.Err("NOT_REPOSITORY", "该目录不是有效的 Git 仓库")
	case strings.Contains(lower, "nothing to commit"):
		return model.Err("NOTHING_TO_COMMIT", "没有已暂存的修改可提交")
	default:
		return model.Err("GIT_FAILED", "Git 操作失败，请检查分支、文件状态或使用外部终端诊断")
	}
}
func (r Runner) Version(ctx context.Context) (string, error) {
	binary := r.Binary
	if binary == "" {
		binary = "git"
	}
	cmd := exec.CommandContext(ctx, binary, "--version")
	cmd.Env = CleanEnv()
	hideWindow(cmd)
	b, err := cmd.Output()
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	if err != nil {
		return "", model.Err("GIT_MISSING", "未找到 Git，请安装 Git 或在设置中配置可执行文件路径")
	}
	version := strings.TrimSpace(string(b))
	var major, minor int
	if !strings.HasPrefix(version, "git version ") {
		return "", model.Err("GIT_INVALID", "配置的可执行文件未返回有效 Git 版本，请检查 Git 路径")
	}
	if _, err = fmt.Sscanf(strings.TrimPrefix(version, "git version "), "%d.%d", &major, &minor); err != nil {
		return "", model.Err("GIT_INVALID", "无法识别 Git 版本，请检查安装")
	}
	if major < 2 || major == 2 && minor < 23 {
		return "", model.Err("GIT_TOO_OLD", "需要 Git 2.23 或更新版本，请升级 Git 后重试")
	}
	return version, nil
}
func (r Runner) Root(ctx context.Context, path string) (string, error) {
	out, err := r.Run(ctx, path, nil, nil, "rev-parse", "--show-toplevel")
	if err != nil {
		return "", err
	}
	return filepath.EvalSymlinks(strings.TrimSpace(out))
}
func (r Runner) Remotes(ctx context.Context, path string) ([]Remote, error) {
	out, err := r.Run(ctx, path, nil, nil, "remote")
	if err != nil {
		return nil, err
	}
	result := []Remote{}
	for _, name := range strings.Fields(out) {
		u, err := r.Run(ctx, path, nil, nil, "remote", "get-url", name)
		if err != nil {
			return nil, err
		}
		pu, err := r.Run(ctx, path, nil, nil, "remote", "get-url", "--push", name)
		if err != nil {
			return nil, err
		}
		fetchURL, pushURL := strings.TrimSpace(u), strings.TrimSpace(pu)
		if embeddedCredentials(fetchURL) || embeddedCredentials(pushURL) {
			return nil, model.Err("REMOTE_CREDENTIALS", "远程 URL 含有内嵌凭据，请在外部工具中移除后重新导入")
		}
		result = append(result, Remote{Name: name, URL: fetchURL, PushURL: pushURL})
	}
	return result, nil
}
func embeddedCredentials(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.User == nil {
		return false
	}
	_, password := u.User.Password()
	return password || u.Scheme != "ssh"
}
func (r Runner) Status(ctx context.Context, path string) (Status, error) {
	s := Status{Files: []FileStatus{}, Remotes: []Remote{}}
	out, err := r.Run(ctx, path, nil, nil, "status", "--porcelain=v1", "-z", "--untracked-files=all")
	if err != nil {
		return s, err
	}
	s.Files = ParseStatus(out)
	branch, err := r.Run(ctx, path, nil, nil, "symbolic-ref", "--short", "-q", "HEAD")
	if err != nil {
		s.Branch = "HEAD"
		s.Detached = true
	} else {
		s.Branch = strings.TrimSpace(branch)
	}
	up, err := r.Run(ctx, path, nil, nil, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
	if err == nil {
		s.Upstream = strings.TrimSpace(up)
		counts, err := r.Run(ctx, path, nil, nil, "rev-list", "--left-right", "--count", "HEAD...@{upstream}")
		if err == nil {
			_, _ = fmt.Sscanf(counts, "%d\t%d", &s.Ahead, &s.Behind)
		}
	}
	s.Remotes, err = r.Remotes(ctx, path)
	return s, err
}
func ParseStatus(out string) []FileStatus {
	result := []FileStatus{}
	parts := strings.Split(out, "\x00")
	for i := 0; i < len(parts); i++ {
		p := parts[i]
		if len(p) < 4 {
			continue
		}
		f := FileStatus{Index: p[:1], Worktree: p[1:2], Path: p[3:]}
		if strings.ContainsAny(p[:2], "RC") && i+1 < len(parts) {
			i++
			f.OriginalPath = parts[i]
		}
		result = append(result, f)
	}
	return result
}
func (r Runner) Diff(ctx context.Context, path, file string, staged bool) (string, error) {
	args := []string{"diff", "--no-ext-diff", "--no-textconv", "--no-color", "--patch"}
	if staged {
		args = append(args, "--cached")
	}
	args = append(args, "--", file)
	return r.Run(ctx, path, nil, nil, args...)
}
func (r Runner) CommitDiff(ctx context.Context, path, hash string) (string, error) {
	if !regexp.MustCompile(`^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$`).MatchString(hash) {
		return "", model.Err("INVALID_COMMIT", "请选择有效的提交")
	}
	return r.Run(ctx, path, nil, nil, "show", "--format=", "--no-ext-diff", "--no-textconv", "--find-renames", hash, "--")
}
func (r Runner) History(ctx context.Context, path string) ([]Commit, error) {
	out, err := r.Run(ctx, path, nil, nil, "log", "-50", "--format=%H%x00%an%x00%ae%x00%aI%x00%s%x00")
	if err != nil {
		if _, headErr := r.Run(ctx, path, nil, nil, "rev-parse", "--verify", "HEAD"); headErr != nil {
			return []Commit{}, nil
		}
		return nil, err
	}
	fields := strings.Split(out, "\x00")
	result := []Commit{}
	for i := 0; i+4 < len(fields); i += 5 {
		result = append(result, Commit{strings.TrimSpace(fields[i]), fields[i+1], fields[i+2], fields[i+3], fields[i+4]})
	}
	return result, nil
}
func (r Runner) Branches(ctx context.Context, path string) ([]Branch, error) {
	out, err := r.Run(ctx, path, nil, nil, "for-each-ref", "--format=%(HEAD)%00%(refname:short)", "refs/heads/")
	if err != nil {
		return nil, err
	}
	result := []Branch{}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		p := strings.SplitN(line, "\x00", 2)
		if len(p) == 2 {
			result = append(result, Branch{strings.TrimSpace(p[1]), strings.TrimSpace(p[0]) == "*"})
		}
	}
	return result, nil
}
func ValidFile(path string) error {
	if path == "" || filepath.IsAbs(path) || strings.Contains(path, "\x00") || strings.HasPrefix(path, "-") {
		return model.Err("INVALID_PATH", "文件路径无效")
	}
	for _, p := range strings.Split(filepath.ToSlash(path), "/") {
		if p == ".." || p == ".git" {
			return model.Err("INVALID_PATH", "文件路径不能越过工作区或指向 Git 元数据")
		}
	}
	return nil
}
func (r Runner) Stage(ctx context.Context, path, file string, stage bool) error {
	if err := ValidFile(file); err != nil {
		return err
	}
	args := []string{"add", "--", file}
	if !stage {
		paths := []string{file}
		if raw, err := r.Run(ctx, path, nil, nil, "status", "--porcelain=v1", "-z"); err == nil {
			for _, f := range ParseStatus(raw) {
				if f.Path == file && f.OriginalPath != "" {
					if err := ValidFile(f.OriginalPath); err != nil {
						return err
					}
					paths = append(paths, f.OriginalPath)
				}
			}
		}
		if _, err := r.Run(ctx, path, nil, nil, "rev-parse", "--verify", "HEAD"); err == nil {
			args = append([]string{"restore", "--staged", "--"}, paths...)
		} else {
			args = append([]string{"rm", "--cached", "--"}, paths...)
		}
	}
	_, err := r.Run(ctx, path, nil, nil, args...)
	return err
}
func (r Runner) Commit(ctx context.Context, path, message, name, email string) error {
	if strings.TrimSpace(message) == "" || strings.TrimSpace(name) == "" || strings.TrimSpace(email) == "" || strings.ContainsAny(name+email, "\r\n\x00") {
		return model.Err("IDENTITY_REQUIRED", "请填写提交信息并确认姓名和邮箱")
	}
	_, err := r.Run(ctx, path, nil, []string{"user.name=" + name, "user.email=" + email, "author.name=" + name, "author.email=" + email, "committer.name=" + name, "committer.email=" + email, "commit.gpgsign=false"}, "commit", "-m", message)
	return err
}
func (r Runner) Switch(ctx context.Context, path, name string, create bool) error {
	if name == "" || strings.HasPrefix(name, "-") {
		return model.Err("BRANCH_INVALID", "分支名称无效")
	}
	if _, err := r.Run(ctx, path, nil, nil, "check-ref-format", "--branch", name); err != nil {
		return model.Err("BRANCH_INVALID", "分支名称无效")
	}
	args := []string{"switch"}
	if create {
		args = append(args, "-c")
	}
	args = append(args, name)
	_, err := r.Run(ctx, path, nil, nil, args...)
	return err
}
func (r Runner) Network(ctx context.Context, path, operation, remote string, auth Auth) error {
	if remote == "" || strings.HasPrefix(remote, "-") {
		return model.Err("REMOTE_INVALID", "请先选择远程仓库")
	}
	remotes, err := r.Remotes(ctx, path)
	if err != nil {
		return err
	}
	found := false
	for _, v := range remotes {
		if v.Name == remote {
			u := v.URL
			if operation == "push" {
				u = v.PushURL
			}
			a, e := GitHubTarget(u)
			b, e2 := GitHubTarget(auth.URL)
			if e != nil {
				return e
			}
			if e2 != nil || a != b {
				return model.Err("REMOTE_CHANGED", "远程地址已变化，请重新绑定")
			}
			found = true
		}
	}
	if !found {
		return model.Err("REMOTE_INVALID", "远程仓库不存在")
	}
	if operation == "push" {
		all, err := r.Run(ctx, path, nil, nil, "remote", "get-url", "--push", "--all", remote)
		if err != nil {
			return err
		}
		if len(strings.Split(strings.TrimSpace(all), "\n")) != 1 {
			return model.Err("REMOTE_INVALID", "该 remote 配置了多个 push URL，请在外部工具中确认后再使用应用内推送")
		}
	}
	var args []string
	switch operation {
	case "fetch":
		args = []string{"fetch", "--progress", remote}
	case "pull":
		branch, err := r.networkBranch(ctx, path, remote)
		if err != nil {
			return err
		}
		args = []string{"pull", "--ff-only", "--no-rebase", remote, branch}
	case "push":
		branch, err := r.networkBranch(ctx, path, remote)
		if err != nil {
			return err
		}
		// An explicit, non-forced refspec prevents remote.*.push and push.default
		// from silently choosing other refs or introducing a force prefix.
		args = []string{"push", "--progress", "--set-upstream", remote, "HEAD:refs/heads/" + branch}
	default:
		return model.Err("INVALID_OPERATION", "不支持的网络操作")
	}
	_, err = r.Run(ctx, path, &auth, []string{"push.followTags=false", "push.recurseSubmodules=no"}, args...)
	return err
}
func (r Runner) Clone(ctx context.Context, url, dest string, auth Auth) error {
	if _, err := GitHubTarget(url); err != nil {
		return err
	}
	if _, err := os.Stat(dest); err == nil {
		return model.Err("DEST_EXISTS", "目标目录已存在，请选择新目录")
	}
	parent := filepath.Dir(dest)
	staging, err := os.MkdirTemp(parent, ".repo-berth-clone-")
	if err != nil {
		return model.Err("INVALID_PATH", "无法在目标父目录中创建临时克隆目录")
	}
	defer func() {
		if filepath.Dir(staging) == parent && strings.HasPrefix(filepath.Base(staging), ".repo-berth-clone-") {
			_ = os.RemoveAll(staging)
		}
	}()
	cloned := filepath.Join(staging, "repository")
	if _, err = r.Run(ctx, parent, &auth, nil, "clone", "--progress", "--", url, cloned); err != nil {
		return err
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	if _, err = os.Lstat(dest); !os.IsNotExist(err) {
		return model.Err("DEST_EXISTS", "目标目录已被创建，请选择其他目录")
	}
	if err = os.Rename(cloned, dest); err != nil {
		return model.Err("CLONE_FINALIZE", "克隆完成但无法移动到目标目录，请检查权限后重试")
	}
	return nil
}
func (r Runner) networkBranch(ctx context.Context, path, remote string) (string, error) {
	current, err := r.Run(ctx, path, nil, nil, "symbolic-ref", "--short", "-q", "HEAD")
	if err != nil {
		return "", model.Err("DETACHED_HEAD", "当前处于分离 HEAD 状态，请先切换到本地分支")
	}
	current = strings.TrimSpace(current)
	info, err := r.Run(ctx, path, nil, nil, "for-each-ref", "--format=%(upstream:remotename)%00%(upstream:remoteref)", "refs/heads/"+current)
	if err == nil {
		parts := strings.SplitN(strings.TrimSpace(info), "\x00", 2)
		if len(parts) == 2 && parts[0] == remote && strings.HasPrefix(parts[1], "refs/heads/") {
			return strings.TrimPrefix(parts[1], "refs/heads/"), nil
		}
	}
	return current, nil
}
func Canonical(path string) (string, error) {
	p, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	p, err = filepath.EvalSymlinks(p)
	if err != nil {
		return "", model.Err("INVALID_PATH", "目录不存在或无法访问")
	}
	if runtime.GOOS == "windows" {
		p = strings.ToLower(p)
	}
	return filepath.Clean(p), nil
}
