package gitexec

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

// Git's name-only/raw output still includes EOL-only modifications even when
// --ignore-cr-at-eol is set. Numstat omits those files. Compare both in one
// invocation, retaining metadata changes, binary files, symlinks and submodules.
func (r Runner) lineEndingDiff(ctx context.Context, path string, staged bool) (string, map[string]bool, error) {
	args := []string{"diff", "--no-ext-diff", "--no-textconv", "--no-relative", "--ignore-cr-at-eol", "--raw", "--numstat", "-z", "-M"}
	if staged {
		args = append(args, "--cached")
	}
	raw, err := r.Run(ctx, path, nil, nil, args...)
	if err != nil {
		return "", nil, err
	}
	parts := strings.Split(raw, "\x00")
	ignored := map[string]bool{}
	i := 0
	for i+1 < len(parts) && strings.HasPrefix(parts[i], ":") {
		fields := strings.Fields(parts[i])
		if len(fields) != 5 {
			// An unfamiliar format must not hide changes.
			return "", nil, nil
		}
		file := parts[i+1]
		if fields[4] == "M" && fields[0] == ":"+fields[1] && (fields[1] == "100644" || fields[1] == "100755") {
			ignored[file] = true
		}
		i += 2
		if strings.HasPrefix(fields[4], "R") || strings.HasPrefix(fields[4], "C") {
			i++
		}
	}
	numstat := strings.Join(parts[i:], "\x00")
	for ; i < len(parts); i++ {
		cols := strings.SplitN(parts[i], "\t", 3)
		if len(cols) != 3 {
			continue
		}
		file := cols[2]
		if file == "" && i+2 < len(parts) {
			i += 2
			file = parts[i]
		}
		delete(ignored, file)
	}
	// --ignore-cr-at-eol also suppresses some final-newline differences. Only
	// hide files whose bytes actually match after CRLF -> LF conversion.
	for file := range ignored {
		base := ":" + file
		if staged {
			base = "HEAD:" + file
		}
		before, err := r.Run(ctx, path, nil, nil, "show", base)
		if err != nil {
			delete(ignored, file)
			continue
		}
		var after []byte
		if staged {
			text, err := r.Run(ctx, path, nil, nil, "show", ":"+file)
			if err != nil {
				delete(ignored, file)
				continue
			}
			after = []byte(text)
		} else {
			f, err := os.Open(filepath.Join(path, filepath.FromSlash(file)))
			if err != nil {
				delete(ignored, file)
				continue
			}
			after, err = io.ReadAll(io.LimitReader(f, (4<<20)+1))
			_ = f.Close()
			if err != nil || len(after) > 4<<20 {
				delete(ignored, file)
				continue
			}
		}
		if bytes.IndexByte([]byte(before), 0) >= 0 || bytes.IndexByte(after, 0) >= 0 || !utf8.ValidString(before) || !utf8.Valid(after) ||
			!bytes.Equal(bytes.ReplaceAll([]byte(before), []byte("\r\n"), []byte("\n")), bytes.ReplaceAll(after, []byte("\r\n"), []byte("\n"))) {
			delete(ignored, file)
			args := []string{"diff", "--no-ext-diff", "--no-textconv", "--no-relative", "--numstat", "-z"}
			if staged {
				args = append(args, "--cached")
			}
			args = append(args, "--", file)
			if stats, err := r.Run(ctx, path, nil, nil, args...); err == nil {
				numstat += stats
			}
		}
	}
	return numstat, ignored, nil
}

func hideLineEndingChanges(files []FileStatus, ignored map[string]bool, staged bool) []FileStatus {
	result := files[:0]
	for _, file := range files {
		if ignored[file.Path] {
			if staged && file.Index == "M" {
				file.Index = " "
			} else if !staged && file.Worktree == "M" {
				file.Worktree = " "
			}
		}
		if file.Index != " " || file.Worktree != " " {
			result = append(result, file)
		}
	}
	return result
}

// Expand directory selections before adding, so hidden EOL-only files cannot
// sneak into bulk staging. Use porcelain paths rather than filesystem walks to
// preserve Git's ignore rules, deletions and literal path handling.
func (r Runner) contentStagePaths(ctx context.Context, path string, requested []string) ([]string, error) {
	_, ignored, err := r.lineEndingDiff(ctx, path, false)
	if err != nil {
		return nil, err
	}
	if len(ignored) == 0 {
		return requested, nil
	}
	raw, err := r.Run(ctx, path, nil, nil, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--renames")
	if err != nil {
		return nil, err
	}
	paths := []string{}
	for _, file := range ParseStatus(raw) {
		if ignored[file.Path] && file.Worktree == "M" {
			continue
		}
		for _, selected := range requested {
			selected = strings.TrimSuffix(strings.ReplaceAll(selected, "\\", "/"), "/")
			if file.Path == selected || strings.HasPrefix(file.Path, selected+"/") {
				paths = append(paths, file.Path)
				break
			}
		}
	}
	return paths, nil
}
