package gitexec

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"

	"repo-berth/internal/model"
)

type RecoveryRequest struct {
	Kind             string   `json:"kind"`
	Paths            []string `json:"paths"`
	All              bool     `json:"all"`
	IncludeUntracked bool     `json:"includeUntracked"`
	Target           string   `json:"target"`
	Mode             string   `json:"mode"`
}
type RecoveryFile struct {
	Path   string `json:"path"`
	Action string `json:"action"`
}
type RecoveryPlan struct {
	Head         string         `json:"head"`
	Target       string         `json:"target"`
	Branch       string         `json:"branch"`
	Commits      int            `json:"commits"`
	Files        []RecoveryFile `json:"files"`
	Fingerprint  string         `json:"fingerprint"`
	restorePaths []string
	deletePaths  []string
}

func recoveryPathKey(name string) string {
	if runtime.GOOS == "windows" {
		return strings.ToLower(name)
	}
	return name
}

func mutationPath(root *os.Root, name string) (string, error) {
	if err := ValidFile(name); err != nil {
		return "", err
	}
	parts := strings.Split(filepath.ToSlash(name), "/")
	current := ""
	for i, part := range parts {
		if part == "" || part == "." || strings.EqualFold(strings.TrimRight(part, " ."), ".git") {
			return "", model.Err("INVALID_PATH", "请选择工作区内的具体文件")
		}
		current = filepath.Join(current, part)
		info, err := root.Lstat(current)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return "", err
		}
		if info.Mode()&os.ModeIrregular != 0 || (i < len(parts)-1 && (!info.IsDir() || info.Mode()&os.ModeSymlink != 0)) {
			return "", model.Err("UNSAFE_PATH", "文件路径经过符号链接或非目录，无法安全撤销")
		}
		if i == len(parts)-1 && info.IsDir() {
			return "", model.Err("NESTED_REPOSITORY", "不能通过丢弃操作删除目录或嵌套仓库，请先单独处理")
		}
	}
	return current, nil
}

func (r Runner) recoveryState(ctx context.Context, root string) (head, branch, status, index string, err error) {
	head, err = r.Run(ctx, root, nil, nil, "rev-parse", "--verify", "HEAD")
	if err != nil {
		if _, e := r.Run(ctx, root, nil, nil, "symbolic-ref", "--quiet", "HEAD"); e != nil {
			return "", "", "", "", err
		}
		head = ""
	}
	head = strings.TrimSpace(head)
	branch, _ = r.Run(ctx, root, nil, nil, "symbolic-ref", "--quiet", "--short", "HEAD")
	status, err = r.Run(ctx, root, nil, nil, "status", "--porcelain=v1", "-z", "--untracked-files=all")
	if err != nil {
		return
	}
	index, err = r.Run(ctx, root, nil, nil, "ls-files", "--stage", "-z")
	return
}

func (r Runner) PreviewRecovery(ctx context.Context, root string, req RecoveryRequest) (RecoveryPlan, error) {
	plan := RecoveryPlan{Files: []RecoveryFile{}}
	if req.Kind != "discard" && req.Kind != "reset" {
		return plan, model.Err("INVALID_OPERATION", "不支持的撤销操作")
	}
	if req.Kind == "discard" && !req.All && len(req.Paths) == 0 {
		return plan, model.Err("INVALID_PATH", "请选择要丢弃修改的文件或目录")
	}
	for _, p := range req.Paths {
		if err := ValidFile(p); err != nil {
			return plan, err
		}
	}
	head, branch, raw, index, err := r.recoveryState(ctx, root)
	if err != nil {
		return plan, err
	}
	plan.Head, plan.Branch = head, strings.TrimSpace(branch)
	indexFiles := map[string]bool{}
	for _, entry := range strings.Split(index, "\x00") {
		meta, name, ok := strings.Cut(entry, "\t")
		if !ok {
			continue
		}
		fields := strings.Fields(meta)
		if len(fields) != 3 || fields[2] != "0" {
			return plan, model.Err("UNMERGED", "仓库有未解决的冲突，请先处理冲突或中止合并")
		}
		if fields[0] == "160000" {
			return plan, model.Err("SUBMODULE", "仓库包含 submodule，请在外部 Git 工具中执行重置或丢弃操作")
		}
		indexFiles[name] = true
	}
	headFiles := map[string]bool{}
	if head != "" {
		out, e := r.Run(ctx, root, nil, nil, "ls-tree", "-r", "--name-only", "-z", head)
		if e != nil {
			return plan, e
		}
		for _, p := range strings.Split(out, "\x00") {
			if p != "" {
				headFiles[p] = true
			}
		}
	}
	actions := map[string]string{}
	selected := func(p string) bool {
		if req.All || req.Kind == "reset" {
			return true
		}
		for _, wanted := range req.Paths {
			if p == wanted || strings.HasPrefix(p, strings.TrimSuffix(wanted, "/")+"/") {
				return true
			}
		}
		return false
	}
	for _, f := range ParseStatus(raw) {
		if !selected(f.Path) {
			continue
		}
		untracked := f.Index == "?"
		if untracked && req.Kind == "reset" {
			continue
		}
		if untracked && req.Kind == "discard" && !req.IncludeUntracked {
			continue
		}
		original := ""
		if f.Index == "R" || f.Worktree == "R" {
			original = f.OriginalPath
		}
		for _, p := range []string{f.Path, original} {
			if p == "" {
				continue
			}
			if req.Kind == "reset" {
				actions[p] = "change"
				continue
			}
			if headFiles[p] || indexFiles[p] {
				plan.restorePaths = append(plan.restorePaths, p)
			}
			if headFiles[p] {
				actions[p] = "restore"
			} else {
				actions[p] = "delete"
				plan.deletePaths = append(plan.deletePaths, p)
			}
		}
	}
	if req.Kind == "reset" {
		if !regexp.MustCompile(`^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$`).MatchString(req.Target) || (req.Mode != "soft" && req.Mode != "mixed" && req.Mode != "hard") {
			return plan, model.Err("INVALID_OPERATION", "请选择有效提交及 soft、mixed 或 hard 模式")
		}
		if head == "" {
			return plan, model.Err("NO_COMMITS", "仓库尚无提交，无法回退历史")
		}
		// Do not turn reset into an implicit merge/rebase abort.
		for _, marker := range []string{"MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"} {
			p, e := r.Run(ctx, root, nil, nil, "rev-parse", "--git-path", marker)
			if e != nil {
				return plan, e
			}
			p = strings.TrimSpace(p)
			if !filepath.IsAbs(p) {
				p = filepath.Join(root, p)
			}
			if _, e := os.Stat(p); e == nil {
				return plan, model.Err("OPERATION_IN_PROGRESS", "请先完成或中止正在进行的合并、rebase 或 cherry-pick")
			}
		}
		target, e := r.Run(ctx, root, nil, nil, "rev-parse", "--verify", req.Target+"^{commit}")
		if e != nil {
			return plan, e
		}
		plan.Target = strings.TrimSpace(target)
		count, e := r.Run(ctx, root, nil, nil, "rev-list", "--count", plan.Target+".."+head)
		if e != nil {
			return plan, e
		}
		_, _ = fmt.Sscan(count, &plan.Commits)
		changed, e := r.Run(ctx, root, nil, nil, "diff", "--no-renames", "--name-only", "-z", head, plan.Target, "--")
		if e != nil {
			return plan, e
		}
		for _, p := range strings.Split(changed, "\x00") {
			if p != "" {
				actions[p] = "change"
			}
		}
		if req.Mode == "hard" {
			tree, e := r.Run(ctx, root, nil, nil, "ls-tree", "-r", "-z", plan.Target)
			if e != nil {
				return plan, e
			}
			targetFiles := map[string]bool{}
			for _, entry := range strings.Split(tree, "\x00") {
				meta, name, ok := strings.Cut(entry, "\t")
				if !ok {
					continue
				}
				if strings.HasPrefix(meta, "160000 ") {
					return plan, model.Err("SUBMODULE", "目标提交包含 submodule，请使用外部 Git 工具重置")
				}
				targetFiles[name] = true
				if err := ctx.Err(); err != nil {
					return plan, err
				}
			}
			if err := r.checkRecoveryConflicts(ctx, root, targetFiles); err != nil {
				return plan, err
			}
			for name := range actions {
				if targetFiles[name] {
					actions[name] = "restore"
				} else {
					actions[name] = "delete"
				}
			}
		}
	}
	if req.Kind == "discard" {
		restored := map[string]bool{}
		for _, path := range plan.restorePaths {
			if headFiles[path] {
				restored[path] = true
			}
		}
		if len(restored) > 0 {
			if err := r.checkRecoveryConflicts(ctx, root, restored); err != nil {
				return plan, err
			}
		}
	}
	paths := make([]string, 0, len(actions))
	for p := range actions {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	workspace, err := os.OpenRoot(root)
	if err != nil {
		return plan, err
	}
	defer workspace.Close()
	h := sha256.New()
	encoded, _ := json.Marshal(req)
	fmt.Fprintf(h, "%s\x00%s\x00%s\x00%s\x00%s\x00%s", root, encoded, head, branch, raw, index)
	for _, p := range paths {
		name, err := mutationPath(workspace, p)
		if err != nil {
			return plan, err
		}
		fmt.Fprintf(h, "\x00%s\x00%s\x00", p, actions[p])
		info, err := workspace.Lstat(name)
		if os.IsNotExist(err) {
			io.WriteString(h, "missing")
		} else if err != nil {
			return plan, err
		} else {
			fmt.Fprintf(h, "%s\x00%d\x00%d\x00", info.Mode(), info.Size(), info.ModTime().UnixNano())
			if info.Mode()&os.ModeSymlink != 0 {
				dest, e := workspace.Readlink(name)
				if e != nil {
					return plan, e
				}
				io.WriteString(h, dest)
			} else {
				if !info.Mode().IsRegular() {
					return plan, model.Err("UNSAFE_PATH", "无法撤销特殊文件："+p)
				}
				f, e := workspace.Open(name)
				if e != nil {
					return plan, e
				}
				_, e = io.Copy(h, f)
				closeErr := f.Close()
				if e != nil {
					return plan, e
				}
				if closeErr != nil {
					return plan, closeErr
				}
			}
		}
		plan.Files = append(plan.Files, RecoveryFile{Path: p, Action: actions[p]})
		if err := ctx.Err(); err != nil {
			return plan, err
		}
	}
	plan.Fingerprint = hex.EncodeToString(h.Sum(nil))
	return plan, nil
}

// Check against both untracked and ignored paths before an operation writes tracked files.
func (r Runner) checkRecoveryConflicts(ctx context.Context, root string, targets map[string]bool) error {
	raw, err := r.Run(ctx, root, nil, nil, "ls-files", "--others", "-z")
	if err != nil {
		return err
	}
	names := map[string]string{}
	for _, name := range strings.Split(raw, "\x00") {
		name = strings.TrimSuffix(name, "/")
		if name != "" {
			names[recoveryPathKey(name)] = name
		}
	}
	keys := make([]string, 0, len(names))
	for key := range names {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for target := range targets {
		if err := ctx.Err(); err != nil {
			return err
		}
		key := recoveryPathKey(target)
		conflict := names[key]
		prefix := key + "/"
		if i := sort.SearchStrings(keys, prefix); conflict == "" && i < len(keys) && strings.HasPrefix(keys[i], prefix) {
			conflict = names[keys[i]]
		}
		for parent := key; conflict == ""; {
			at := strings.LastIndexByte(parent, '/')
			if at < 0 {
				break
			}
			parent = parent[:at]
			conflict = names[parent]
		}
		if conflict != "" {
			return model.Err("UNTRACKED_CONFLICT", "恢复目标会覆盖未跟踪或被忽略的文件："+conflict+"；请先移走或保存该文件")
		}
	}
	return nil
}

func (r Runner) ApplyRecovery(ctx context.Context, root string, req RecoveryRequest, fingerprint string) error {
	plan, err := r.PreviewRecovery(ctx, root, req)
	if err != nil {
		return err
	}
	if fingerprint == "" || fingerprint != plan.Fingerprint {
		return model.Err("RECOVERY_CHANGED", "预览后仓库内容已变化，请重新预览并确认，未执行撤销操作")
	}
	if req.Kind == "reset" {
		_, err = r.Run(ctx, root, nil, nil, "reset", "--"+req.Mode, "--no-recurse-submodules", plan.Target, "--")
		return err
	}
	if len(plan.restorePaths) > 0 {
		args := []string{"restore", "--source=" + plan.Head, "--staged", "--worktree", "--pathspec-from-file=-", "--pathspec-file-nul"}
		if plan.Head == "" {
			args = []string{"rm", "--cached", "--force", "--pathspec-from-file=-", "--pathspec-file-nul"}
		}
		if _, err = r.runInput(ctx, root, nil, nil, strings.Join(plan.restorePaths, "\x00")+"\x00", args...); err != nil {
			return err
		}
	}
	if len(plan.deletePaths) == 0 {
		return nil
	}
	workspace, err := os.OpenRoot(root)
	if err != nil {
		return err
	}
	defer workspace.Close()
	for _, p := range plan.deletePaths {
		name, err := mutationPath(workspace, p)
		if err != nil {
			return err
		}
		if err := workspace.Remove(name); err != nil && !os.IsNotExist(err) {
			return model.Err("DISCARD_PARTIAL", "部分文件未能删除，请刷新并检查文件权限；已执行的撤销不会自动回滚")
		}
	}
	return nil
}
