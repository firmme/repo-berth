package service

import "repo-berth/internal/model"

// AttachUpdater connects the UI-triggered update check to the application's
// updater. The callback should start the update flow without blocking.
func AttachUpdater(s *Service, check func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.checkUpdates = check
}

// CheckForUpdates starts the application update flow. The updater opens its
// own window and reports progress there.
func (s *Service) CheckForUpdates() error {
	s.mu.Lock()
	check := s.checkUpdates
	s.mu.Unlock()
	if check == nil {
		return model.Err("UPDATER_UNAVAILABLE", "当前构建不支持检查更新")
	}
	check()
	return nil
}

// AutoUpdateEnabled reports whether the user allows the startup update check.
func (s *Service) AutoUpdateEnabled() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return !s.state.Settings.AutoUpdateDisabled
}
