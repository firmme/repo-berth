package service

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"strings"

	"repo-berth/internal/gitexec"
	"repo-berth/internal/model"
)

const maxEditableFile = 2 << 20

// Validate path components before passing repository-relative names to os.Root.
func workingFilePath(root *os.Root, file string) (string, error) {
	if err := gitexec.ValidFile(file); err != nil {
		return "", err
	}
	rel := filepath.FromSlash(file)
	// Check the original components before cleaning, since cleaning can hide aliases.
	if !filepath.IsLocal(rel) || filepath.Clean(rel) == "." {
		return "", model.Err("INVALID_PATH", "文件路径无效")
	}
	rel = filepath.Clean(rel)
	current := ""
	for _, part := range strings.Split(rel, string(filepath.Separator)) {
		current = filepath.Join(current, part)
		info, err := root.Lstat(current)
		if os.IsNotExist(err) {
			break
		}
		if err != nil {
			return "", err
		}
		if info.Mode()&(os.ModeSymlink|os.ModeIrregular) != 0 {
			return "", model.Err("UNSAFE_PATH", "工作区文件操作不支持符号链接或重解析路径")
		}
	}
	return rel, nil
}

func openWorkingFilePath(base, file string) (*os.Root, string, error) {
	root, err := os.OpenRoot(base)
	if err != nil {
		return nil, "", err
	}
	name, err := workingFilePath(root, file)
	if err != nil {
		root.Close()
		return nil, "", err
	}
	return root, name, nil
}

func readWorkingBytes(root *os.Root, name string, limit int64) ([]byte, error) {
	info, err := root.Lstat(name)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, model.Err("NOT_FILE", "请选择普通文件")
	}
	if info.Size() > limit {
		return nil, model.Err("FILE_TOO_LARGE", "文件超出内置编辑或预览大小限制，请使用外部工具")
	}
	handle, err := root.Open(name)
	if err != nil {
		return nil, err
	}
	defer handle.Close()
	content, err := io.ReadAll(io.LimitReader(handle, limit+1))
	if int64(len(content)) > limit {
		return nil, model.Err("FILE_TOO_LARGE", "文件超出内置编辑或预览大小限制，请使用外部工具")
	}
	return content, err
}

type WorkingFileDocument struct {
	Content string `json:"content"`
	Version string `json:"version"`
}

func documentVersion(content []byte) string {
	sum := sha256.Sum256(content)
	return hex.EncodeToString(sum[:])
}

func (s *Service) GitFileContent(id, file string) (string, error) {
	document, err := s.ReadWorkingDocument(id, file)
	return document.Content, err
}

func (s *Service) ReadWorkingDocument(id, file string) (WorkingFileDocument, error) {
	c, err := s.gitCheckout(id)
	if err != nil {
		return WorkingFileDocument{}, err
	}
	root, name, err := openWorkingFilePath(c.Path, file)
	if err != nil {
		return WorkingFileDocument{}, err
	}
	defer root.Close()
	content, err := readWorkingBytes(root, name, maxEditableFile)
	if os.IsNotExist(err) {
		return WorkingFileDocument{}, model.Err("FILE_MISSING", "文件不存在，可能已被删除")
	}
	if err != nil {
		return WorkingFileDocument{}, err
	}
	text, _, binaryFile := decodeText(content)
	if binaryFile {
		return WorkingFileDocument{}, model.Err("BINARY_FILE", "二进制文件不支持应用内编辑")
	}
	return WorkingFileDocument{Content: text, Version: documentVersion(content)}, nil
}

func (s *Service) SaveWorkingFile(id, file, content string) error {
	_, err := s.saveWorkingFile(id, file, content, "")
	return err
}

func (s *Service) SaveWorkingDocument(id, file, content, version string) (string, error) {
	if version == "" {
		return "", model.Err("FILE_CHANGED", "请重新打开文件后再保存")
	}
	return s.saveWorkingFile(id, file, content, version)
}

func (s *Service) saveWorkingFile(id, file, content, version string) (string, error) {
	c, err := s.gitCheckout(id)
	if err != nil {
		return "", err
	}
	if len(content) > maxEditableFile {
		return "", model.Err("FILE_TOO_LARGE", "文件超过 2 MiB，无法保存")
	}
	lock := s.workLock(c.Path)
	if err := lock.Lock(s.ctx); err != nil {
		return "", err
	}
	defer lock.Unlock()
	if err := s.validateCheckout(c); err != nil {
		return "", err
	}
	root, name, err := openWorkingFilePath(c.Path, file)
	if err != nil {
		return "", err
	}
	defer root.Close()

	existing, readErr := readWorkingBytes(root, name, maxEditableFile)
	if readErr != nil && !os.IsNotExist(readErr) {
		return "", readErr
	}
	if version != "" && (readErr != nil || documentVersion(existing) != version) {
		return "", model.Err("FILE_CHANGED", "磁盘文件已修改或删除。编辑内容已保留，请先处理外部变更")
	}
	encoding, lineEnding, previousEnding := "UTF-8", "LF", "None"
	if readErr == nil {
		text, detected, binaryFile := decodeText(existing)
		if binaryFile {
			return "", model.Err("BINARY_FILE", "二进制文件不支持应用内编辑")
		}
		if normalizeLineEndings(text, "LF") == normalizeLineEndings(content, "LF") {
			return documentVersion(existing), nil
		}
		encoding = detected
		previousEnding = detectLineEnding(text)
		if previousEnding != "Mixed" && previousEnding != "None" {
			lineEnding = previousEnding
		}
	}
	payload, err := encodeText(content, encoding, lineEnding)
	if err != nil {
		return "", model.Err("WRITE_FAILED", "无法编码文件内容")
	}
	if len(payload) > maxEditableFile {
		return "", model.Err("FILE_TOO_LARGE", "文件编码后超过 2 MiB，无法保存")
	}
	if err := replaceWorkingDocument(root, name, payload, version); err != nil {
		return "", err
	}
	if previousEnding == "None" {
		previousEnding = detectLineEnding(content)
	}
	if previousEnding != lineEnding && previousEnding != "None" {
		_ = s.recordLineEndingNotice(c.ID, []string{file + "：" + previousEnding + " → " + lineEnding + "（保存文件）"})
	}
	return documentVersion(payload), nil
}

// Write the new bytes first so a write failure cannot truncate the document.
func replaceWorkingDocument(root *os.Root, name string, payload []byte, version string) error {
	mode := os.FileMode(0o644)
	if info, err := root.Lstat(name); err == nil {
		if !info.Mode().IsRegular() {
			return model.Err("NOT_FILE", "请选择普通文件")
		}
		mode = info.Mode().Perm()
	} else if !os.IsNotExist(err) {
		return err
	}
	temp := filepath.Join(filepath.Dir(name), ".repo-berth-save-"+model.ID())
	file, err := root.OpenFile(temp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if err != nil {
		return model.Err("WRITE_FAILED", "无法保存文件，请检查权限")
	}
	defer root.Remove(temp)
	_, writeErr := file.Write(payload)
	closeErr := file.Close()
	if writeErr != nil || closeErr != nil {
		return model.Err("WRITE_FAILED", "无法保存文件，请检查权限和磁盘空间")
	}
	if version != "" {
		current, err := readWorkingBytes(root, name, maxEditableFile)
		if err != nil || documentVersion(current) != version {
			return model.Err("FILE_CHANGED", "磁盘文件已修改或删除。编辑内容已保留，请先处理外部变更")
		}
	}
	if err := root.Rename(temp, name); err != nil {
		return model.Err("WRITE_FAILED", "无法替换文件，请检查文件权限或是否被占用")
	}
	return nil
}

func (s *Service) CreateWorkingFile(id, file string) error {
	c, err := s.gitCheckout(id)
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
	root, name, err := openWorkingFilePath(c.Path, file)
	if err != nil {
		return err
	}
	defer root.Close()
	if _, err := root.Lstat(name); err == nil {
		return model.Err("FILE_EXISTS", "文件已存在")
	} else if !os.IsNotExist(err) {
		return model.Err("WRITE_FAILED", "无法访问目标路径，请检查权限")
	}
	if err := root.MkdirAll(filepath.Dir(name), 0o755); err != nil {
		return model.Err("WRITE_FAILED", "无法创建目录，请检查权限")
	}
	handle, err := root.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
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
	root, name, err := openWorkingFilePath(c.Path, ".gitignore")
	if err != nil {
		return err
	}
	defer root.Close()
	content, err := readWorkingBytes(root, name, maxEditableFile)
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
	if err := root.WriteFile(name, []byte(text), 0o644); err != nil {
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
	return s.stageWithLineEndingNotice(c, []string{file}, func() error {
		_, err := s.runner().Run(s.ctx, c.Path, nil, nil, "add", "-f", "--", file)
		return err
	})
}
