package vault

import (
	"github.com/zalando/go-keyring"
	"repo-berth/internal/model"
	"sync"
)

type Vault interface {
	Get(string) (string, error)
	Set(string, string, bool) error
	Delete(string) error
}
type System struct {
	mu      sync.Mutex
	session map[string]string
}

func New() *System { return &System{session: map[string]string{}} }
func (v *System) Get(ref string) (string, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if t, ok := v.session[ref]; ok {
		return t, nil
	}
	t, err := keyring.Get("RepoBerth", ref)
	if err != nil {
		return "", model.Err("AUTH_REQUIRED", "凭据不可用，请重新授权账号")
	}
	return t, nil
}
func (v *System) Set(ref, token string, session bool) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	if session {
		v.session[ref] = token
		return nil
	}
	if err := keyring.Set("RepoBerth", ref, token); err != nil {
		return model.Err("VAULT_UNAVAILABLE", "系统凭据库不可用；可重新选择仅本次会话保存")
	}
	delete(v.session, ref)
	return nil
}
func (v *System) Delete(ref string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	if _, ok := v.session[ref]; ok {
		delete(v.session, ref)
		return nil
	}
	err := keyring.Delete("RepoBerth", ref)
	if err == keyring.ErrNotFound {
		return nil
	}
	if err != nil {
		return model.Err("VAULT_UNAVAILABLE", "无法清除系统凭据，请解锁系统凭据库后重试")
	}
	return nil
}
