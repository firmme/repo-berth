package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"strconv"
	"strings"

	"repo-berth/internal/gitexec"
	"repo-berth/internal/model"
)

type CommitBinaryDiff struct {
	Path            string `json:"path"`
	OldSize         int64  `json:"oldSize"`
	NewSize         int64  `json:"newSize"`
	OldHash         string `json:"oldHash"`
	NewHash         string `json:"newHash"`
	OldExists       bool   `json:"oldExists"`
	NewExists       bool   `json:"newExists"`
	OldData         string `json:"oldData"`
	NewData         string `json:"newData"`
	FirstDifference int    `json:"firstDifference"`
	ChangedBytes    int    `json:"changedBytes"`
	Truncated       bool   `json:"truncated"`
	WindowSize      int    `json:"windowSize"`
}

func validCommitHash(hash string) bool {
	if len(hash) < 4 || len(hash) > 64 {
		return false
	}
	for _, char := range hash {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F')) {
			return false
		}
	}
	return true
}

func (s *Service) commitBlob(ctx context.Context, path, hash, file string) ([]byte, error) {
	out, err := s.runner().Run(ctx, path, nil, nil, "show", hash+":"+file)
	if err != nil {
		return nil, err
	}
	return []byte(out), nil
}

func (s *Service) commitBlobSize(ctx context.Context, path, hash, file string) (int64, error) {
	out, err := s.runner().Run(ctx, path, nil, nil, "cat-file", "-s", hash+":"+file)
	if err != nil {
		return 0, err
	}
	return strconv.ParseInt(strings.TrimSpace(out), 10, 64)
}

func (s *Service) commitBlobHash(ctx context.Context, path, hash, file string) string {
	out, err := s.runner().Run(ctx, path, nil, nil, "rev-parse", hash+":"+file)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(out)
}

func (s *Service) commitParent(ctx context.Context, path, hash string) string {
	out, err := s.runner().Run(ctx, path, nil, nil, "rev-parse", "--verify", "--quiet", hash+"^")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(out)
}

func (s *Service) readCommitFile(ctx context.Context, path, hash, file string) ([]byte, int64, bool, error) {
	data, err := s.commitBlob(ctx, path, hash, file)
	if err == nil {
		size, sizeErr := s.commitBlobSize(ctx, path, hash, file)
		if sizeErr != nil {
			size = int64(len(data))
		}
		return data, size, true, nil
	}
	parent := s.commitParent(ctx, path, hash)
	if parent == "" {
		return nil, 0, false, err
	}
	data, parentErr := s.commitBlob(ctx, path, parent, file)
	if parentErr != nil {
		return nil, 0, false, parentErr
	}
	size, sizeErr := s.commitBlobSize(ctx, path, parent, file)
	if sizeErr != nil {
		size = int64(len(data))
	}
	return data, size, false, nil
}

func (s *Service) GitCommitFileInfo(id, hash, file string) (WorkingFileInfo, error) {
	if !validCommitHash(hash) {
		return WorkingFileInfo{}, model.Err("INVALID_COMMIT", "提交标识无效")
	}
	if err := gitexec.ValidFile(file); err != nil {
		return WorkingFileInfo{}, err
	}
	c, err := s.gitCheckout(id)
	if err != nil {
		return WorkingFileInfo{}, err
	}
	data, size, _, err := s.readCommitFile(s.ctx, c.Path, hash, file)
	if err != nil {
		return WorkingFileInfo{}, model.Err("FILE_MISSING", "该提交中不存在此文件")
	}
	if len(data) > 256<<10 {
		data = data[:256<<10]
	}
	return buildFileInfo(file, size, data), nil
}

func (s *Service) GitCommitFilePreview(id, hash, file string) (WorkingFilePreview, error) {
	info, err := s.GitCommitFileInfo(id, hash, file)
	if err != nil {
		return WorkingFilePreview{}, err
	}
	switch info.PreviewKind {
	case "image", "audio", "video":
	default:
		return WorkingFilePreview{}, model.Err("PREVIEW_UNSUPPORTED", "该文件类型不支持内置预览")
	}
	if info.Size > 4<<20 {
		return WorkingFilePreview{}, model.Err("FILE_TOO_LARGE", "文件超过 4 MiB，请检出后使用默认应用打开")
	}
	c, err := s.gitCheckout(id)
	if err != nil {
		return WorkingFilePreview{}, err
	}
	data, size, _, err := s.readCommitFile(s.ctx, c.Path, hash, file)
	if err != nil {
		return WorkingFilePreview{}, model.Err("READ_FAILED", "无法读取该提交中的文件")
	}
	return WorkingFilePreview{
		Kind:     info.PreviewKind,
		MIMEType: info.MIMEType,
		Data:     base64.StdEncoding.EncodeToString(data),
		Size:     size,
	}, nil
}

func (s *Service) GitCommitBinaryDiff(id, hash, file string) (CommitBinaryDiff, error) {
	if !validCommitHash(hash) {
		return CommitBinaryDiff{}, model.Err("INVALID_COMMIT", "提交标识无效")
	}
	if err := gitexec.ValidFile(file); err != nil {
		return CommitBinaryDiff{}, err
	}
	c, err := s.gitCheckout(id)
	if err != nil {
		return CommitBinaryDiff{}, err
	}
	ctx := s.ctx
	result := CommitBinaryDiff{
		Path:            file,
		OldData:         "",
		NewData:         "",
		FirstDifference: -1,
		WindowSize:      64 << 10,
	}
	parent := s.commitParent(ctx, c.Path, hash)
	if parent != "" {
		oldSize, sizeErr := s.commitBlobSize(ctx, c.Path, parent, file)
		oldData, readErr := s.commitBlob(ctx, c.Path, parent, file)
		if sizeErr == nil && readErr == nil {
			result.OldExists = true
			result.OldSize = oldSize
			result.OldHash = s.commitBlobHash(ctx, c.Path, parent, file)
			result.OldData = base64.StdEncoding.EncodeToString(oldData)
		}
	}
	newSize, newErr := s.commitBlobSize(ctx, c.Path, hash, file)
	newData, readErr := s.commitBlob(ctx, c.Path, hash, file)
	if newErr == nil && readErr == nil {
		result.NewExists = true
		result.NewSize = newSize
		result.NewHash = s.commitBlobHash(ctx, c.Path, hash, file)
		result.NewData = base64.StdEncoding.EncodeToString(newData)
	}
	if !result.OldExists && !result.NewExists {
		return CommitBinaryDiff{}, model.Err("FILE_MISSING", "该提交中不存在此文件")
	}
	oldWindow, _ := base64.StdEncoding.DecodeString(result.OldData)
	newWindow, _ := base64.StdEncoding.DecodeString(result.NewData)
	if len(oldWindow) > result.WindowSize {
		oldWindow = oldWindow[:result.WindowSize]
	}
	if len(newWindow) > result.WindowSize {
		newWindow = newWindow[:result.WindowSize]
	}
	result.Truncated = result.OldSize > int64(len(oldWindow)) || result.NewSize > int64(len(newWindow))
	result.OldData = base64.StdEncoding.EncodeToString(oldWindow)
	result.NewData = base64.StdEncoding.EncodeToString(newWindow)
	if result.OldHash == result.NewHash && result.OldHash != "" {
		return result, nil
	}
	limit := len(newWindow)
	if len(oldWindow) < limit {
		limit = len(oldWindow)
	}
	for index := 0; index < limit; index++ {
		if oldWindow[index] != newWindow[index] {
			if result.FirstDifference < 0 {
				result.FirstDifference = index
			}
			result.ChangedBytes++
		}
	}
	if len(newWindow) > len(oldWindow) {
		if result.FirstDifference < 0 {
			result.FirstDifference = len(oldWindow)
		}
		result.ChangedBytes += len(newWindow) - len(oldWindow)
	} else if len(oldWindow) > len(newWindow) {
		if result.FirstDifference < 0 {
			result.FirstDifference = len(newWindow)
		}
		result.ChangedBytes += len(oldWindow) - len(newWindow)
	}
	if !result.OldExists && bytes.Equal(oldWindow, newWindow) {
		result.ChangedBytes = len(newWindow)
	}
	return result, nil
}
