package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"repo-berth/internal/model"
	"strings"
	"testing"
	"time"
)

func TestRepositoryPaginationAndDeduplication(t *testing.T) {
	pages := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-secret" {
			t.Error("missing auth")
		}
		pages++
		repos := []map[string]any{}
		if r.URL.Query().Get("page") == "1" {
			for i := 1; i <= 100; i++ {
				repos = append(repos, map[string]any{"id": i, "name": fmt.Sprint(i)})
			}
		} else {
			repos = append(repos, map[string]any{"id": 100, "name": "duplicate"}, map[string]any{"id": 101, "name": "final"})
		}
		_ = json.NewEncoder(w).Encode(repos)
	}))
	defer server.Close()
	g := NewGitHub()
	g.API = server.URL
	repos, err := g.Repositories(context.Background(), "test-secret")
	if err != nil {
		t.Fatal(err)
	}
	if len(repos) != 101 || pages != 2 {
		t.Fatalf("pages=%d repos=%d", pages, len(repos))
	}
}
func TestDeviceSlowDownAndSuccess(t *testing.T) {
	attempts := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.Form.Get("client_secret") != "" {
			t.Error("desktop sent a secret")
		}
		attempts++
		switch attempts {
		case 1:
			fmt.Fprint(w, `{"error":"authorization_pending"}`)
		case 2:
			fmt.Fprint(w, `{"error":"slow_down"}`)
		default:
			fmt.Fprint(w, `{"access_token":"test-token"}`)
		}
	}))
	defer server.Close()
	g := NewGitHub()
	g.OAuth = server.URL
	var intervals []time.Duration
	g.wait = func(ctx context.Context, d time.Duration) error { intervals = append(intervals, d); return ctx.Err() }
	token, err := g.PollDevice(context.Background(), "client", DeviceCode{DeviceCode: "code", ExpiresIn: 600, Interval: 5})
	if err != nil {
		t.Fatal(err)
	}
	if token != "test-token" || len(intervals) != 3 || intervals[2] != 10*time.Second {
		t.Fatalf("poll %v", intervals)
	}
}
func TestAuthorizationFailureCodes(t *testing.T) {
	for _, tc := range []struct{ reply, code string }{{"access_denied", "AUTH_DENIED"}, {"expired_token", "AUTH_EXPIRED"}, {"incorrect_client_credentials", "AUTH_FAILED"}} {
		t.Run(tc.reply, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprintf(w, `{"error":%q}`, tc.reply) }))
			defer server.Close()
			g := NewGitHub()
			g.OAuth = server.URL
			g.wait = func(context.Context, time.Duration) error { return nil }
			_, err := g.PollDevice(context.Background(), "client", DeviceCode{ExpiresIn: 600})
			ae, ok := err.(*model.AppError)
			if !ok || ae.Code != tc.code {
				t.Fatalf("got %v", err)
			}
		})
	}
}
func TestProviderErrorsDoNotLeakResponse(t *testing.T) {
	for _, tc := range []struct {
		status int
		rate   string
		code   string
	}{{401, "", "AUTH_REQUIRED"}, {403, "", "PERMISSION"}, {403, "0", "RATE_LIMIT"}, {429, "", "RATE_LIMIT"}, {500, "", "PROVIDER"}} {
		t.Run(tc.code, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if tc.rate != "" {
					w.Header().Set("X-RateLimit-Remaining", tc.rate)
				}
				w.WriteHeader(tc.status)
				fmt.Fprint(w, "test-secret-token")
			}))
			defer server.Close()
			g := NewGitHub()
			g.API = server.URL
			_, err := g.CurrentUser(context.Background(), "test-secret-token")
			ae, ok := err.(*model.AppError)
			if !ok || ae.Code != tc.code || strings.Contains(err.Error(), "test-secret") {
				t.Fatalf("error %v", err)
			}
		})
	}
}
func TestRealPollCancellation(t *testing.T) {
	g := NewGitHub()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := g.PollDevice(ctx, "client", DeviceCode{ExpiresIn: 600, Interval: 5})
	if err != context.Canceled {
		t.Fatalf("expected cancellation, got %v", err)
	}
}
