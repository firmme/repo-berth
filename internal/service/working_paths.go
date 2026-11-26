package service

import (
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"repo-berth/internal/gitexec"
	"repo-berth/internal/model"
)

func validEntryName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" || name == "." || name == ".." || strings.HasPrefix(name, "-") {
		return model.Err("INVALID_PATH", "文件或目录名称无效")
	}
	if strings.ContainsAny(name, `/\`+"\x00") || strings.ContainsAny(name, `<>:"|?*`) {
		return model.Err("INVALID_PATH", "文件或目录名称包含无效字符")
	}
	return gitexec.ValidFile(name)
}

func (s *Service) CreateWorkingDirectory(id, path string) error {
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
	root, full, err := openWorkingFilePath(c.Path, path)
	if err != nil {
		return err
	}
	defer root.Close()
	if _, err := root.Lstat(full); err == nil {
		return model.Err("FILE_EXISTS", "目标已存在")
	} else if !os.IsNotExist(err) {
		return model.Err("WRITE_FAILED", "无法访问目标路径，请检查权限")
	}
	if err := root.MkdirAll(full, 0o755); err != nil {
		return model.Err("WRITE_FAILED", "无法创建目录，请检查权限")
	}
	return nil
}

func (s *Service) RenameWorkingPath(id, path, name string) error {
	c, err := s.gitCheckout(id)
	if err != nil {
		return err
	}
	if err := validEntryName(name); err != nil {
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
	root, oldFull, err := openWorkingFilePath(c.Path, path)
	if err != nil {
		return err
	}
	defer root.Close()
	newFull := filepath.Join(filepath.Dir(oldFull), strings.TrimSpace(name))
	if _, err := root.Lstat(oldFull); err != nil {
		return model.Err("FILE_MISSING", "目标不存在，可能已被删除")
	}
	if _, err := root.Lstat(newFull); err == nil {
		return model.Err("FILE_EXISTS", "同名文件或目录已存在")
	} else if !os.IsNotExist(err) {
		return model.Err("WRITE_FAILED", "无法访问目标路径，请检查权限")
	}
	if err := root.Rename(oldFull, newFull); err != nil {
		return model.Err("WRITE_FAILED", "无法重命名，请检查权限或文件是否被占用")
	}
	return nil
}

func (s *Service) DeleteWorkingPath(id, path string) error {
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
	root, full, err := openWorkingFilePath(c.Path, path)
	if err != nil {
		return err
	}
	defer root.Close()
	info, err := root.Lstat(full)
	if err != nil {
		return model.Err("FILE_MISSING", "目标不存在，可能已被删除")
	}
	if info.IsDir() {
		if err := root.RemoveAll(full); err != nil {
			return model.Err("WRITE_FAILED", "无法删除目录，请检查权限")
		}
		return nil
	}
	if err := root.Remove(full); err != nil {
		return model.Err("WRITE_FAILED", "无法删除文件，请检查权限")
	}
	return nil
}

func (s *Service) CopyWorkingPath(id, source, destinationDir string, cut bool) error {
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
	root, src, err := openWorkingFilePath(c.Path, source)
	if err != nil {
		return err
	}
	defer root.Close()
	destRoot := "."
	if destinationDir != "" {
		destRoot, err = workingFilePath(root, destinationDir)
		if err != nil {
			return err
		}
	}
	dest := filepath.Join(destRoot, filepath.Base(src))
	rel, err := filepath.Rel(src, dest)
	if err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return model.Err("INVALID_PATH", "不能把目录复制或移动到自身内部")
	}
	if _, err := root.Lstat(src); err != nil {
		return model.Err("FILE_MISSING", "源文件不存在，可能已被删除")
	}
	if stat, err := root.Lstat(destRoot); err != nil || !stat.IsDir() {
		return model.Err("FILE_MISSING", "目标目录不存在")
	}
	if _, err := root.Lstat(dest); err == nil {
		return model.Err("FILE_EXISTS", "目标位置已有同名文件或目录")
	} else if !os.IsNotExist(err) {
		return model.Err("WRITE_FAILED", "无法访问目标路径，请检查权限")
	}
	if cut {
		if err := root.Rename(src, dest); err != nil {
			return model.Err("WRITE_FAILED", "无法移动，请检查权限或文件是否被占用")
		}
		return nil
	}
	if err := copyWorkingPath(root, src, dest); err != nil {
		return model.Err("WRITE_FAILED", "无法复制文件，请检查权限")
	}
	return nil
}

func copyWorkingPath(root *os.Root, src, dest string) error {
	info, err := root.Lstat(src)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() && !info.IsDir() {
		return model.Err("UNSUPPORTED", "只支持复制普通文件和目录")
	}
	if info.IsDir() {
		if err := root.Mkdir(dest, info.Mode().Perm()); err != nil {
			return err
		}
		entries, err := fs.ReadDir(root.FS(), filepath.ToSlash(src))
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if err := copyWorkingPath(
				root,
				filepath.Join(src, entry.Name()),
				filepath.Join(dest, entry.Name()),
			); err != nil {
				return err
			}
		}
		return nil
	}
	in, err := root.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := root.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, info.Mode().Perm())
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}

func (s *Service) OpenWorkingPath(id, path, kind string) error {
	c, err := s.checkout(id)
	if err != nil {
		return err
	}
	full := c.Path
	if path != "" {
		if err := gitexec.ValidFile(path); err != nil {
			return err
		}
		root, name, err := openWorkingFilePath(c.Path, path)
		if err != nil {
			return err
		}
		defer root.Close()
		full = filepath.Join(root.Name(), name)
	}
	info, err := os.Lstat(full)
	if err != nil {
		return model.Err("FILE_MISSING", "目标不存在，可能已被删除")
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return model.Err("NOT_FILE", "暂不支持打开符号链接")
	}
	switch kind {
	case "folder", "terminal":
		if !info.IsDir() {
			full = filepath.Dir(full)
		}
	case "default", "editor", "vscode", "reveal":
	default:
		return model.Err("INVALID_OPERATION", "不支持的打开方式")
	}
	s.mu.Lock()
	d := s.desktop
	editor := s.state.Settings.EditorPath
	terminal := s.state.Settings.TerminalPath
	s.mu.Unlock()
	if d == nil {
		return model.Err("DESKTOP_REQUIRED", "桌面应用应负责打开路径")
	}
	if kind == "terminal" {
		err = d.OpenTerminal(full, terminal)
	} else {
		err = d.OpenPath(full, kind, editor)
	}
	if err != nil {
		return model.Err("OPEN_FAILED", "无法打开外部工具，请检查设置和安装路径")
	}
	return nil
}
