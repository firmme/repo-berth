package service

import (
	"context"
	"strings"
	"testing"

	"repo-berth/internal/model"
	"repo-berth/internal/provider"
)

type applicationClientProbe struct {
	fakeProvider
	client string
}

func (p *applicationClientProbe) StartDevice(ctx context.Context, client string) (provider.DeviceCode, error) {
	p.client = client
	return p.fakeProvider.StartDevice(ctx, client)
}

func TestApplicationOAuthConfigurationDoesNotRequireUserClientID(t *testing.T) {
	previous := GitHubOAuthClientID
	GitHubOAuthClientID = "publisher-public-client"
	defer func() { GitHubOAuthClientID = previous }()
	s, _, _ := newTestService(t, &fakeProvider{})
	p := &applicationClientProbe{fakeProvider: fakeProvider{user: provider.User{ID: 1, Login: "personal"}}}
	s.provider = p
	for _, legacy := range []string{"", "old-user-client"} {
		if err := s.SaveSettings(model.Settings{GitPath: "git", ClientID: legacy}); err != nil {
			t.Fatal(err)
		}
		st, err := s.Snapshot()
		if err != nil || !st.GitHubAuthConfigured {
			t.Fatalf("application login not advertised: %v %+v", err, st)
		}
		auth, err := s.StartAuthorization(false, "")
		if err != nil {
			t.Fatal(err)
		}
		if p.client != "publisher-public-client" {
			t.Fatalf("used per-user OAuth app: %q", p.client)
		}
		if task := waitTask(t, s, auth.TaskID); task.State != "succeeded" {
			t.Fatalf("authorization: %+v", task)
		}
	}
}

func TestUnconfiguredBuildIsAnApplicationErrorNotAUserSetupStep(t *testing.T) {
	previous := GitHubOAuthClientID
	GitHubOAuthClientID = ""
	defer func() { GitHubOAuthClientID = previous }()
	s, _, _ := newTestService(t, &fakeProvider{})
	if err := s.SaveSettings(model.Settings{GitPath: "git"}); err != nil {
		t.Fatal(err)
	}
	st, err := s.Snapshot()
	if err != nil || st.GitHubAuthConfigured {
		t.Fatalf("misleading login availability: %v", err)
	}
	if _, err := s.StartAuthorization(false, ""); err == nil || !strings.HasPrefix(err.Error(), "AUTH_BUILD_UNCONFIGURED:") {
		t.Fatalf("missing publisher config was not identified: %v", err)
	}
}
