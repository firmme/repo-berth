package service

import (
	"context"
	"time"

	"repo-berth/internal/gitexec"
)

func (s *Service) PreviewGitRecovery(id string, request gitexec.RecoveryRequest) (gitexec.RecoveryPlan, error) {
	c, err := s.gitCheckout(id)
	if err != nil {
		return gitexec.RecoveryPlan{}, err
	}
	ctx, cancel := context.WithTimeout(s.ctx, 2*time.Minute)
	defer cancel()
	lock := s.workLock(c.Path)
	if err := lock.Lock(ctx); err != nil {
		return gitexec.RecoveryPlan{}, err
	}
	defer lock.Unlock()
	if err := s.validateCheckout(c); err != nil {
		return gitexec.RecoveryPlan{}, err
	}
	return s.runner().PreviewRecovery(ctx, c.Path, request)
}

func (s *Service) ApplyGitRecovery(id string, request gitexec.RecoveryRequest, fingerprint string) error {
	c, err := s.gitCheckout(id)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(s.ctx, 2*time.Minute)
	defer cancel()
	lock := s.workLock(c.Path)
	if err := lock.Lock(ctx); err != nil {
		return err
	}
	defer lock.Unlock()
	if err := s.validateCheckout(c); err != nil {
		return err
	}
	return s.runner().ApplyRecovery(ctx, c.Path, request, fingerprint)
}
