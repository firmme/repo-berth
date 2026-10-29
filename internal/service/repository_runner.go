package service

import (
	"os"
	"path/filepath"
	"repo-berth/internal/gitexec"
)

// User-selected imports and scan candidates are read directly. Scope the Git
// ownership exception to their actual worktree root; never trust a scan root,
// drive, wildcard, or modify the user's Git configuration.
func (s *Service) repositoryRunner(path string) gitexec.Runner {
	runner := s.runner()
	canonical, err := gitexec.Canonical(path)
	if err != nil {
		return runner
	}
	for candidate := canonical; ; candidate = filepath.Dir(candidate) {
		if _, err := os.Stat(filepath.Join(candidate, ".git")); err == nil {
			runner.TrustedDirectories = append(runner.TrustedDirectories, candidate)
			break
		}
		if filepath.Dir(candidate) == candidate {
			break
		}
	}
	return runner
}
