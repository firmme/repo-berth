package service

import (
	"os"
	"path/filepath"
	"strings"

	"repo-berth/internal/gitexec"
	"repo-berth/internal/model"
)

const maxEditableFile = 2 << 20

func workingFilePath(root, file string) (string, error) {
	if err := gitexec.ValidFile(file); err != nil {
		return "", err
	}
	root = filepath.Clean(root)
	full := filepath.Join(root, filepath.FromSlash(file))
	rel, err := filepath.Rel(root, full)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", model.Err("INVALID_PATH", "文件路径无效")
	}
	return full, nil
}

func (s *Service) GitFileContent(id, file string) (string, error) {
	c, err := s.gitCheckout(id)
	if err != nil {
		return "", err
	}
	full, err := workingFilePath(c.Path, file)
	if err != nil {
		return "", err
	}
	info, err := os.Lstat(full)
	if err != nil {
		return "", model.Err("FILE_MISSING", "文件不存在，可能已被删除")
	}
	if info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", model.Err("NOT_FILE", "请选择普通文本文件")
	}
	if info.Size() > maxEditableFile {
		return "", model.Err("FILE_TOO_LARGE", "文件超过 2 MiB，请在外部编辑器中打开")
	}
	content, err := os.ReadFile(full)
	if err != nil {
		return "", model.Err("READ_FAILED", "无法读取文件，请检查权限")
	}
	text, _, binaryFile := decodeText(content)
	if binaryFile {
		return "", model.Err("BINARY_FILE", "二进制文件不支持应用内编辑")
	}
	return text, nil
}

func (s *Service) SaveWorkingFile(id, file, content string) error {
	c, err := s.gitCheckout(id)
	if err != nil {
		return err
	}
	full, err := workingFilePath(c.Path, file)
	if err != nil {
		return err
	}
	if len(content) > maxEditableFile {
		return model.Err("FILE_TOO_LARGE", "文件超过 2 MiB，无法保存")
	}
	lock := s.workLock(c.Path)
	if err := lock.Lock(s.ctx); err != nil {
		return err
	}
	defer lock.Unlock()
	if err := s.validateCheckout(c); err != nil {
		return err
	}
	if info, err := os.Lstat(full); err == nil {
		if info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return model.Err("NOT_FILE", "请选择普通文本文件")
		}
	} else if !os.IsNotExist(err) {
		return model.Err("WRITE_FAILED", "无法访问文件，请检查权限")
	}
	encoding, lineEnding := "UTF-8", "LF"
	if existing, readErr := os.ReadFile(full); readErr == nil {
		text, detected, binaryFile := decodeText(existing)
		if !binaryFile {
			encoding = detected
			lineEnding = detectLineEnding(text)
			if lineEnding == "Mixed" || lineEnding == "None" {
				lineEnding = "LF"
			}
		}
	}
	payload, err := encodeText(content, encoding, lineEnding)
	if err != nil {
		return model.Err("WRITE_FAILED", "无法保存文件，请检查权限")
	}
	if err := os.WriteFile(full, payload, 0o644); err != nil {
		return model.Err("WRITE_FAILED", "无法保存文件，请检查权限")
	}
	return nil
}

func (s *Service) CreateWorkingFile(id, file string) error {
	c, err := s.gitCheckout(id)
	if err != nil {
		return err
	}
	full, err := workingFilePath(c.Path, file)
	if err != nil {
		return err
	}
	lock := s.workLock(c.Path)
	if err := lock.Lock(s.ctx); err != nil {
		return err
	}
	defer lock.Unlock()
	if err := s.validateCheckout(c); err != nil {
		return err
	}
	if _, err := os.Lstat(full); err == nil {
		return model.Err("FILE_EXISTS", "文件已存在")
	} else if !os.IsNotExist(err) {
		return model.Err("WRITE_FAILED", "无法访问目标路径，请检查权限")
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return model.Err("WRITE_FAILED", "无法创建目录，请检查权限")
	}
	handle, err := os.OpenFile(full, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return model.Err("WRITE_FAILED", "无法创建文件，请检查权限")
	}
	return handle.Close()
}

func gitignorePattern(path string, directory bool) string {
	path = strings.Trim(filepath.ToSlash(path), "/")
	var b strings.Builder
	b.WriteString("/")
	for _, r := range path {
		if strings.ContainsRune(`\*?[]`, r) {
			b.WriteByte('\\')
		}
		b.WriteRune(r)
	}
	if directory {
		b.WriteString("/")
	}
	return b.String()
}

func (s *Service) AddToGitignore(id, file string, directory bool) error {
	c, err := s.gitCheckout(id)
	if err != nil {
		return err
	}
	if err := gitexec.ValidFile(file); err != nil {
		return err
	}
	lock := s.workLock(c.Path)
	if err := lock.Lock(s.ctx); err != nil {
		return err
	}
	defer lock.Unlock()
	if err := s.validateCheckout(c); err != nil {
		return err
	}
	pattern := gitignorePattern(file, directory)
	path := filepath.Join(c.Path, ".gitignore")
	content, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return model.Err("READ_FAILED", "无法读取 .gitignore，请检查权限")
	}
	text := string(content)
	for _, line := range strings.Split(text, "\n") {
		if strings.TrimSpace(line) == pattern {
			return nil
		}
	}
	if text != "" && !strings.HasSuffix(text, "\n") {
		text += "\n"
	}
	text += pattern + "\n"
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		return model.Err("WRITE_FAILED", "无法更新 .gitignore，请检查权限")
	}
	return nil
}

func (s *Service) UntrackFile(id, file string, recursive bool) error {
	c, err := s.gitCheckout(id)
	if err != nil {
		return err
	}
	if err := gitexec.ValidFile(file); err != nil {
		return err
	}
	lock := s.workLock(c.Path)
	if err := lock.Lock(s.ctx); err != nil {
		return err
	}
	defer lock.Unlock()
	if err := s.validateCheckout(c); err != nil {
		return err
	}
	args := []string{"rm", "--cached"}
	if recursive {
		args = append(args, "-r")
	}
	args = append(args, "--", file)
	_, err = s.runner().Run(s.ctx, c.Path, nil, nil, args...)
	return err
}

func (s *Service) ForceTrackFile(id, file string) error {
	c, err := s.gitCheckout(id)
	if err != nil {
		return err
	}
	if err := gitexec.ValidFile(file); err != nil {
		return err
	}
	lock := s.workLock(c.Path)
	if err := lock.Lock(s.ctx); err != nil {
		return err
	}
	defer lock.Unlock()
	if err := s.validateCheckout(c); err != nil {
		return err
	}
	_, err = s.runner().Run(s.ctx, c.Path, nil, nil, "add", "-f", "--", file)
	return err
}
