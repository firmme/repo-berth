package service

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"repo-berth/internal/gitexec"
	"repo-berth/internal/model"
)

type LineEndingRisk struct {
	Path   string `json:"path"`
	CRLF   int    `json:"crlf"`
	LF     int    `json:"lf"`
	Mixed  bool   `json:"mixed"`
	Policy string `json:"policy"`
}

type lineEndingAttrs struct {
	text string
	eol  string
}

func (s *Service) lineEndingAttrs(ctx context.Context, path string, files []string) (map[string]lineEndingAttrs, error) {
	args := append([]string{"check-attr", "-z", "text", "eol", "--"}, files...)
	raw, err := s.runner().Run(ctx, path, nil, nil, args...)
	if err != nil {
		return nil, err
	}
	attrs := map[string]lineEndingAttrs{}
	parts := strings.Split(raw, "\x00")
	for i := 0; i+2 < len(parts); i += 3 {
		file, name, value := parts[i], parts[i+1], parts[i+2]
		info := attrs[file]
		switch name {
		case "text":
			info.text = value
		case "eol":
			info.eol = value
		}
		attrs[file] = info
	}
	return attrs, nil
}

func validLineEndingFiles(files []string) ([]string, error) {
	seen := map[string]bool{}
	result := []string{}
	for _, file := range files {
		if err := gitexec.ValidFile(file); err != nil {
			return nil, err
		}
		if !seen[file] {
			seen[file] = true
			result = append(result, file)
		}
	}
	return result, nil
}

func countLineEndings(data []byte) (crlf, lf int) {
	crlf = bytes.Count(data, []byte("\r\n"))
	lf = bytes.Count(data, []byte("\n")) - crlf
	return crlf, lf
}

// CheckLineEndingRisks reports files with mixed separators or content that
// conflicts with an explicit eol rule in .gitattributes. It never modifies
// files, so the user can choose whether to normalize or commit as-is.
func (s *Service) CheckLineEndingRisks(id string, files []string) ([]LineEndingRisk, error) {
	c, err := s.gitCheckout(id)
	if err != nil {
		return nil, err
	}
	files, err = validLineEndingFiles(files)
	if err != nil {
		return nil, err
	}
	if len(files) == 0 {
		return []LineEndingRisk{}, nil
	}
	ctx, cancel := context.WithTimeout(s.ctx, 30*time.Second)
	defer cancel()
	attrs, err := s.lineEndingAttrs(ctx, c.Path, files)
	if err != nil {
		return nil, err
	}
	risks := []LineEndingRisk{}
	for _, file := range files {
		info := attrs[file]
		if info.text == "unset" {
			continue
		}
		full, err := workingFilePath(c.Path, file)
		if err != nil {
			return nil, err
		}
		data, err := os.ReadFile(full)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, model.Err("READ_FAILED", "无法读取文件，请检查权限")
		}
		if len(data) > 20<<20 || bytes.IndexByte(data, 0) >= 0 || !utf8.Valid(data) {
			continue
		}
		crlf, lf := countLineEndings(data)
		policy := info.eol
		if policy == "unspecified" || policy == "set" {
			policy = ""
		}
		risk := LineEndingRisk{Path: file, CRLF: crlf, LF: lf, Mixed: crlf > 0 && lf > 0, Policy: policy}
		if risk.Mixed || (policy == "lf" && crlf > 0) || (policy == "crlf" && lf > 0) {
			risks = append(risks, risk)
		}
	}
	return risks, nil
}

// FixLineEndings rewrites text files using the repository's eol attribute.
// Files without an explicit eol rule are normalized to LF, matching what Git
// stores for text content.
func (s *Service) FixLineEndings(id string, files []string) error {
	c, err := s.gitCheckout(id)
	if err != nil {
		return err
	}
	files, err = validLineEndingFiles(files)
	if err != nil {
		return err
	}
	if len(files) == 0 {
		return nil
	}
	lock := s.workLock(c.Path)
	if err := lock.Lock(s.ctx); err != nil {
		return err
	}
	defer lock.Unlock()
	if err := s.validateCheckout(c); err != nil {
		return err
	}
	attrs, err := s.lineEndingAttrs(s.ctx, c.Path, files)
	if err != nil {
		return err
	}
	for _, file := range files {
		raw, err := s.runner().Run(s.ctx, c.Path, nil, nil, "diff", "--name-only", "--", file)
		if err != nil {
			return err
		}
		if strings.TrimSpace(raw) != "" {
			return model.Err("UNSTAGED_CHANGES", "文件还有未暂存修改，请先处理这些改动，或选择原样提交")
		}
	}
	for _, file := range files {
		info := attrs[file]
		if info.text == "unset" {
			continue
		}
		full := filepath.Join(c.Path, filepath.FromSlash(file))
		data, err := os.ReadFile(full)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return model.Err("READ_FAILED", "无法读取文件，请检查权限")
		}
		if bytes.IndexByte(data, 0) >= 0 || !utf8.Valid(data) {
			continue
		}
		text := strings.ReplaceAll(string(data), "\r\n", "\n")
		text = strings.ReplaceAll(text, "\r", "\n")
		if info.eol == "crlf" {
			text = strings.ReplaceAll(text, "\n", "\r\n")
		}
		if err := os.WriteFile(full, []byte(text), 0o644); err != nil {
			return model.Err("WRITE_FAILED", "无法保存文件，请检查权限")
		}
	}
	args := append([]string{"add", "--renormalize", "--"}, files...)
	_, err = s.runner().Run(s.ctx, c.Path, nil, nil, args...)
	return err
}
