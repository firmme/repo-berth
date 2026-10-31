package service

import (
	"strings"

	"repo-berth/internal/model"
	"repo-berth/internal/notices"
)

func (s *Service) ThirdPartyNotices() (notices.Inventory, error) {
	return notices.Load()
}

func (s *Service) OpenLink(url string) error {
	url = strings.TrimSpace(url)
	if len(url) > 2048 || (!strings.HasPrefix(url, "https://") && !strings.HasPrefix(url, "http://")) {
		return model.Err("INVALID_URL", "链接无效")
	}
	s.mu.Lock()
	desktop := s.desktop
	s.mu.Unlock()
	if desktop == nil {
		return model.Err("DESKTOP_REQUIRED", "桌面应用应负责打开链接")
	}
	return desktop.OpenURL(url)
}
