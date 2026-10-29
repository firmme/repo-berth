package service

import (
	"repo-berth/internal/model"
)

func profileForAccount(st *model.State, id string) string {
	for _, p := range st.Profiles {
		if p.AccountID == id {
			return p.ID
		}
	}
	return ""
}
func hasAccount(st *model.State, id string) bool {
	for _, a := range st.Accounts {
		if a.ID == id && id != "" {
			return true
		}
	}
	return false
}

// Only a unique cached access relation is evidence of the access account.
// The owner segment of a URL can be an organization and is not a login identity.
func associateAccounts(st *model.State) {
	explicit := []model.RepositoryBinding{}
	for _, b := range st.Bindings {
		if !b.Automatic {
			explicit = append(explicit, b)
		}
	}
	st.Bindings = explicit
	for _, c := range st.Checkouts {
		if c.PlainDirectory {
			continue
		}
		for _, remote := range c.Remotes {
			bound := false
			for _, b := range st.Bindings {
				if b.CheckoutID == c.ID && b.Remote == remote.Name {
					bound = true
					break
				}
			}
			if bound {
				continue
			}
			key := remoteKey(remote.URL)
			if key == "" {
				continue
			}
			repo := ""
			for _, r := range st.Repositories {
				if remoteKey(r.CloneURL) == key {
					repo = r.ID
					break
				}
			}
			if repo == "" {
				continue
			}
			accounts := map[string]bool{}
			for _, a := range st.Access {
				if a.RepositoryID == repo && hasAccount(st, a.AccountID) {
					accounts[a.AccountID] = true
				}
			}
			if len(accounts) != 1 {
				continue
			}
			for account := range accounts {
				push := remote.PushURL
				if push == "" {
					push = remote.URL
				}
				st.Bindings = append(st.Bindings, model.RepositoryBinding{ID: c.ID + ":" + remote.Name, CheckoutID: c.ID, Remote: remote.Name, AccountID: account, ProfileID: profileForAccount(st, account), RemoteURL: remote.URL, PushURL: push, Automatic: true})
			}
		}
	}
}

func accessBinding(st *model.State, id, remote string) (model.RepositoryBinding, model.CommitProfile, error) {
	var selected model.RepositoryBinding
	for _, b := range st.Bindings {
		if b.CheckoutID == id && b.Remote == remote && hasAccount(st, b.AccountID) {
			selected = b
			break
		}
	}
	if selected.AccountID == "" && hasAccount(st, st.Settings.DefaultAccountID) {
		for _, c := range st.Checkouts {
			if c.ID != id {
				continue
			}
			for _, r := range c.Remotes {
				if r.Name == remote {
					push := r.PushURL
					if push == "" {
						push = r.URL
					}
					selected = model.RepositoryBinding{ID: id + ":" + remote, CheckoutID: id, Remote: remote, AccountID: st.Settings.DefaultAccountID, ProfileID: profileForAccount(st, st.Settings.DefaultAccountID), RemoteURL: r.URL, PushURL: push}
				}
			}
		}
	}
	if selected.AccountID == "" {
		return selected, model.CommitProfile{}, model.Err("BINDING_REQUIRED", "请选择访问账号；仓库没有关联时使用上次选择的默认账号")
	}
	for _, p := range st.Profiles {
		if p.ID == profileForAccount(st, selected.AccountID) {
			return selected, p, nil
		}
	}
	return selected, model.CommitProfile{}, nil
}

// One selection updates the current remote and remembers the fallback account.
// It never navigates to another checkout or changes the commit settings.
func (s *Service) SetAccessAccount(checkoutID, remote, accountID string) error {
	if _, err := s.account(accountID); err != nil {
		return err
	}
	if checkoutID == "" || remote == "" {
		return s.change(func(st *model.State) error {
			if !hasAccount(st, accountID) {
				return model.Err("ACCOUNT_MISSING", "账号已移除")
			}
			st.Settings.DefaultAccountID = accountID
			return nil
		})
	}
	c, err := s.gitCheckout(checkoutID)
	if err != nil {
		return err
	}
	lock := s.workLock(c.Path)
	if err = lock.Lock(s.ctx); err != nil {
		return err
	}
	defer lock.Unlock()
	if err = s.validateCheckout(c); err != nil {
		return err
	}
	remotes, err := s.runner().Remotes(s.ctx, c.Path)
	if err != nil {
		return err
	}
	binding := model.RepositoryBinding{ID: checkoutID + ":" + remote, CheckoutID: checkoutID, Remote: remote, AccountID: accountID}
	found := false
	for _, r := range remotes {
		if r.Name == remote {
			binding.RemoteURL = r.URL
			binding.PushURL = r.PushURL
			found = true
		}
	}
	if !found {
		return model.Err("REMOTE_INVALID", "请选择存在的 remote")
	}
	return s.change(func(st *model.State) error {
		if !hasAccount(st, accountID) {
			return model.Err("ACCOUNT_MISSING", "账号已移除")
		}
		binding.ProfileID = profileForAccount(st, accountID)
		st.Settings.DefaultAccountID = accountID
		for i, b := range st.Bindings {
			if b.CheckoutID == checkoutID && b.Remote == remote {
				st.Bindings[i] = binding
				return nil
			}
		}
		st.Bindings = append(st.Bindings, binding)
		return nil
	})
}
