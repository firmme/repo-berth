package service

import (
	"io"
	"os"
	"path/filepath"
	"strings"

	"repo-berth/internal/gitexec"
	"repo-berth/internal/model"
)

func validEntryName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" || name == "." || name == ".." || name == ".git" || strings.HasPrefix(name, "-") {
		return model.Err("INVALID_PATH", "文件或目录名称无效")
	}
	if strings.ContainsAny(name, `/\`+"\x00") || strings.ContainsAny(name, `<>:"|?*`) {
		return model.Err("INVALID_PATH", "文件或目录名称包含无效字符")
	}
	return nil
}

func (s *Service) CreateWorkingDirectory(id, path string) error {
	c, err := s.gitCheckout(id)
	if err != nil {
		return err
	}
	full, err := workingFilePath(c.Path, path)
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
		return model.Err("FILE_EXISTS", "目标已存在")
	} else if !os.IsNotExist(err) {
		return model.Err("WRITE_FAILED", "无法访问目标路径，请检查权限")
	}
	if err := os.MkdirAll(full, 0o755); err != nil {
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
	oldFull, err := workingFilePath(c.Path, path)
	if err != nil {
		return err
	}
	newFull := filepath.Join(filepath.Dir(oldFull), strings.TrimSpace(name))
	lock := s.workLock(c.Path)
	if err := lock.Lock(s.ctx); err != nil {
		return err
	}
	defer lock.Unlock()
	if err := s.validateCheckout(c); err != nil {
		return err
	}
	if _, err := os.Lstat(oldFull); err != nil {
		return model.Err("FILE_MISSING", "目标不存在，可能已被删除")
	}
	if _, err := os.Lstat(newFull); err == nil {
		return model.Err("FILE_EXISTS", "同名文件或目录已存在")
	} else if !os.IsNotExist(err) {
		return model.Err("WRITE_FAILED", "无法访问目标路径，请检查权限")
	}
	if err := os.Rename(oldFull, newFull); err != nil {
		return model.Err("WRITE_FAILED", "无法重命名，请检查权限或文件是否被占用")
	}
	return nil
}

func (s *Service) DeleteWorkingPath(id, path string) error {
	c, err := s.gitCheckout(id)
	if err != nil {
		return err
	}
	full, err := workingFilePath(c.Path, path)
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
	info, err := os.Lstat(full)
	if err != nil {
		return model.Err("FILE_MISSING", "目标不存在，可能已被删除")
	}
	if info.IsDir() {
		if err := os.RemoveAll(full); err != nil {
			return model.Err("WRITE_FAILED", "无法删除目录，请检查权限")
		}
		return nil
	}
	if err := os.Remove(full); err != nil {
		return model.Err("WRITE_FAILED", "无法删除文件，请检查权限")
	}
	return nil
}

func (s *Service) CopyWorkingPath(id, source, destinationDir string, cut bool) error {
	c, err := s.gitCheckout(id)
	if err != nil {
		return err
	}
	src, err := workingFilePath(c.Path, source)
	if err != nil {
		return err
	}
	destRoot := c.Path
	if destinationDir != "" {
		destRoot, err = workingFilePath(c.Path, destinationDir)
		if err != nil {
			return err
		}
	}
	dest := filepath.Join(destRoot, filepath.Base(src))
	rel, err := filepath.Rel(src, dest)
	if err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return model.Err("INVALID_PATH", "不能把目录复制或移动到自身内部")
	}
	lock := s.workLock(c.Path)
	if err := lock.Lock(s.ctx); err != nil {
		return err
	}
	defer lock.Unlock()
	if err := s.validateCheckout(c); err != nil {
		return err
	}
	info, err := os.Lstat(src)
	if err != nil {
		return model.Err("FILE_MISSING", "源文件不存在，可能已被删除")
	}
	if info.IsDir() {
		if _, err := os.Lstat(destRoot); err != nil {
			return model.Err("FILE_MISSING", "目标目录不存在")
		}
	} else if stat, err := os.Stat(destRoot); err != nil || !stat.IsDir() {
		return model.Err("FILE_MISSING", "目标目录不存在")
	}
	if _, err := os.Lstat(dest); err == nil {
		return model.Err("FILE_EXISTS", "目标位置已有同名文件或目录")
	} else if !os.IsNotExist(err) {
		return model.Err("WRITE_FAILED", "无法访问目标路径，请检查权限")
	}
	if cut {
		if err := os.Rename(src, dest); err != nil {
			return model.Err("WRITE_FAILED", "无法移动，请检查权限或文件是否被占用")
		}
		return nil
	}
	if err := copyWorkingPath(src, dest); err != nil {
		return model.Err("WRITE_FAILED", "无法复制文件，请检查权限")
	}
	return nil
}

func copyWorkingPath(src, dest string) error {
	info, err := os.Lstat(src)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return model.Err("UNSUPPORTED", "暂不支持复制符号链接")
	}
	if info.IsDir() {
		if err := os.Mkdir(dest, info.Mode().Perm()); err != nil {
			return err
		}
		entries, err := os.ReadDir(src)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if err := copyWorkingPath(
				filepath.Join(src, entry.Name()),
				filepath.Join(dest, entry.Name()),
			); err != nil {
				return err
			}
		}
		return nil
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, info.Mode().Perm())
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
		full, err = workingFilePath(c.Path, path)
		if err != nil {
			return err
		}
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
	s.mu.Unlock()
	if d == nil {
		return model.Err("DESKTOP_REQUIRED", "桌面应用应负责打开路径")
	}
	if err := d.OpenPath(full, kind, editor); err != nil {
		return model.Err("OPEN_FAILED", "无法打开外部工具，请检查设置和安装路径")
	}
	return nil
}
