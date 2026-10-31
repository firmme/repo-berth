package service

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	"repo-berth/internal/model"
)

const maxPreviewFile = 32 << 20

type WorkingFileInfo struct {
	Path        string `json:"path"`
	Name        string `json:"name"`
	Size        int64  `json:"size"`
	IsDir       bool   `json:"isDir"`
	Binary      bool   `json:"binary"`
	Encoding    string `json:"encoding"`
	LineEnding  string `json:"lineEnding"`
	MIMEType    string `json:"mimeType"`
	PreviewKind string `json:"previewKind"`
	Editable    bool   `json:"editable"`
	TooLarge    bool   `json:"tooLarge"`
}

type WorkingFilePreview struct {
	Kind     string `json:"kind"`
	MIMEType string `json:"mimeType"`
	Data     string `json:"data"`
	Size     int64  `json:"size"`
}

func decodeText(data []byte) (string, string, bool) {
	switch {
	case bytes.HasPrefix(data, []byte{0xef, 0xbb, 0xbf}):
		body := data[3:]
		if !utf8.Valid(body) {
			return "", "Binary", true
		}
		return string(body), "UTF-8 BOM", false
	case bytes.HasPrefix(data, []byte{0xff, 0xfe}):
		if text, ok := decodeUTF16(data[2:], binary.LittleEndian); ok {
			return text, "UTF-16 LE", false
		}
		return "", "Binary", true
	case bytes.HasPrefix(data, []byte{0xfe, 0xff}):
		if text, ok := decodeUTF16(data[2:], binary.BigEndian); ok {
			return text, "UTF-16 BE", false
		}
		return "", "Binary", true
	}
	if bytes.IndexByte(data, 0) >= 0 || !utf8.Valid(data) {
		return "", "Binary", true
	}
	return string(data), "UTF-8", false
}

func decodeUTF16(data []byte, order binary.ByteOrder) (string, bool) {
	if len(data)%2 != 0 {
		return "", false
	}
	units := make([]uint16, len(data)/2)
	for i := range units {
		units[i] = order.Uint16(data[i*2:])
	}
	return string(utf16.Decode(units)), true
}

func detectLineEnding(text string) string {
	var crlf, lf, cr int
	for i := 0; i < len(text); i++ {
		if text[i] == '\r' {
			if i+1 < len(text) && text[i+1] == '\n' {
				crlf++
				i++
			} else {
				cr++
			}
		} else if text[i] == '\n' {
			lf++
		}
	}
	switch {
	case crlf == 0 && lf == 0 && cr == 0:
		return "None"
	case crlf > 0 && lf == 0 && cr == 0:
		return "CRLF"
	case lf > 0 && crlf == 0 && cr == 0:
		return "LF"
	case cr > 0 && crlf == 0 && lf == 0:
		return "CR"
	default:
		return "Mixed"
	}
}

func normalizeLineEndings(text, lineEnding string) string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	switch lineEnding {
	case "CRLF":
		return strings.ReplaceAll(text, "\n", "\r\n")
	case "CR":
		return strings.ReplaceAll(text, "\n", "\r")
	default:
		return text
	}
}

func encodeText(text, encoding, lineEnding string) ([]byte, error) {
	text = normalizeLineEndings(text, lineEnding)
	switch encoding {
	case "UTF-8 BOM":
		return append([]byte{0xef, 0xbb, 0xbf}, []byte(text)...), nil
	case "UTF-16 LE", "UTF-16 BE":
		units := utf16.Encode([]rune(text))
		out := make([]byte, 2+len(units)*2)
		if encoding == "UTF-16 BE" {
			binary.BigEndian.PutUint16(out, 0xfeff)
			for i, unit := range units {
				binary.BigEndian.PutUint16(out[2+i*2:], unit)
			}
		} else {
			binary.LittleEndian.PutUint16(out, 0xfeff)
			for i, unit := range units {
				binary.LittleEndian.PutUint16(out[2+i*2:], unit)
			}
		}
		return out, nil
	default:
		return []byte(text), nil
	}
}

func previewKind(path string, data []byte, binaryFile bool) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg", ".avif":
		return "image"
	case ".mp3", ".wav", ".ogg", ".oga", ".flac", ".m4a", ".aac", ".opus":
		return "audio"
	case ".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v", ".ogv":
		return "video"
	}
	if binaryFile {
		return "unsupported"
	}
	if len(data) == 0 {
		return "text"
	}
	return "text"
}

func buildFileInfo(path string, size int64, data []byte) WorkingFileInfo {
	text, encoding, binaryFile := decodeText(data)
	result := WorkingFileInfo{
		Path:       path,
		Name:       filepath.Base(path),
		Size:       size,
		Encoding:   encoding,
		LineEnding: "None",
		Binary:     binaryFile,
	}
	if !binaryFile {
		result.LineEnding = detectLineEnding(text)
	}
	result.PreviewKind = previewKind(path, data, binaryFile)
	result.MIMEType = mime.TypeByExtension(strings.ToLower(filepath.Ext(path)))
	if result.MIMEType == "" {
		result.MIMEType = http.DetectContentType(data)
	}
	result.Editable = !binaryFile && size <= maxEditableFile
	result.TooLarge = size > maxEditableFile
	return result
}

func (s *Service) InspectWorkingFile(id, file string) (WorkingFileInfo, error) {
	c, err := s.checkout(id)
	if err != nil {
		return WorkingFileInfo{}, err
	}
	full, err := workingFilePath(c.Path, file)
	if err != nil {
		return WorkingFileInfo{}, err
	}
	info, err := os.Lstat(full)
	if err != nil {
		return WorkingFileInfo{}, model.Err("FILE_MISSING", "文件不存在，可能已被删除")
	}
	if info.IsDir() {
		return WorkingFileInfo{
			Path:        file,
			Name:        filepath.Base(file),
			Size:        info.Size(),
			IsDir:       true,
			Encoding:    "None",
			LineEnding:  "None",
			PreviewKind: "directory",
		}, nil
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return WorkingFileInfo{}, model.Err("NOT_FILE", "请选择普通文件")
	}
	sampleSize := info.Size()
	if sampleSize > 256<<10 {
		sampleSize = 256 << 10
	}
	sample := make([]byte, sampleSize)
	handle, err := os.Open(full)
	if err != nil {
		return WorkingFileInfo{}, model.Err("READ_FAILED", "无法读取文件，请检查权限")
	}
	n, readErr := io.ReadFull(handle, sample)
	_ = handle.Close()
	if readErr != nil && readErr != io.EOF && readErr != io.ErrUnexpectedEOF {
		return WorkingFileInfo{}, model.Err("READ_FAILED", "无法读取文件，请检查权限")
	}
	return buildFileInfo(file, info.Size(), sample[:n]), nil
}

func (s *Service) ReadWorkingFilePreview(id, file string) (WorkingFilePreview, error) {
	info, err := s.InspectWorkingFile(id, file)
	if err != nil {
		return WorkingFilePreview{}, err
	}
	switch info.PreviewKind {
	case "image", "audio", "video":
	default:
		return WorkingFilePreview{}, model.Err("PREVIEW_UNSUPPORTED", "该文件类型不支持内置预览")
	}
	if info.Size > maxPreviewFile {
		return WorkingFilePreview{}, model.Err("FILE_TOO_LARGE", "文件超过 32 MiB，请使用默认应用打开")
	}
	c, err := s.checkout(id)
	if err != nil {
		return WorkingFilePreview{}, err
	}
	full, err := workingFilePath(c.Path, file)
	if err != nil {
		return WorkingFilePreview{}, err
	}
	data, err := os.ReadFile(full)
	if err != nil {
		return WorkingFilePreview{}, model.Err("READ_FAILED", "无法读取文件，请检查权限")
	}
	return WorkingFilePreview{
		Kind:     info.PreviewKind,
		MIMEType: info.MIMEType,
		Data:     base64.StdEncoding.EncodeToString(data),
		Size:     info.Size,
	}, nil
}

func (s *Service) SetWorkingFileFormat(id, file, encoding, lineEnding string) error {
	switch encoding {
	case "UTF-8", "UTF-8 BOM", "UTF-16 LE", "UTF-16 BE":
	default:
		return model.Err("INVALID_ENCODING", "不支持的编码格式")
	}
	switch lineEnding {
	case "LF", "CRLF", "CR":
	default:
		return model.Err("INVALID_LINE_ENDING", "不支持的换行符类型")
	}
	c, err := s.checkout(id)
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
	if info, err := os.Lstat(full); err != nil {
		return model.Err("FILE_MISSING", "文件不存在，可能已被删除")
	} else if info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return model.Err("NOT_FILE", "请选择普通文本文件")
	}
	raw, err := os.ReadFile(full)
	if err != nil {
		return model.Err("READ_FAILED", "无法读取文件，请检查权限")
	}
	text, _, binaryFile := decodeText(raw)
	if binaryFile {
		return model.Err("BINARY_FILE", "二进制文件不能切换文本格式")
	}
	payload, err := encodeText(text, encoding, lineEnding)
	if err != nil {
		return model.Err("WRITE_FAILED", "无法转换文件格式")
	}
	if err := os.WriteFile(full, payload, 0o644); err != nil {
		return model.Err("WRITE_FAILED", "无法保存文件，请检查权限")
	}
	return nil
}
