package gitexec

import (
	"bufio"
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"repo-berth/internal/model"
	"strings"
	"sync"
	"time"
)

type CredentialRequest struct {
	Protocol string `json:"protocol"`
	Host     string `json:"host"`
	Path     string `json:"path"`
}

func GitHubTarget(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host != "github.com" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", model.Err("HTTPS_REQUIRED", "网络操作仅支持 https://github.com/owner/repository.git；SSH 地址需明确转换")
	}
	path := strings.TrimSuffix(strings.Trim(u.Path, "/"), ".git")
	parts := strings.Split(path, "/")
	if len(parts) != 2 {
		return "", model.Err("REMOTE_INVALID", "GitHub 仓库地址无效")
	}
	for _, part := range parts {
		if part == "" || part == "." || part == ".." || strings.ContainsAny(part, "\r\n\\% :@") {
			return "", model.Err("REMOTE_INVALID", "GitHub 仓库地址无效")
		}
	}
	return strings.ToLower(path), nil
}

type CredentialServer struct {
	Endpoint string
	Nonce    string
	server   *http.Server
	listener net.Listener
	done     chan struct{}
	once     sync.Once
}

func StartCredentials(ctx context.Context, target, login, token string) (*CredentialServer, error) {
	l, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	c := &CredentialServer{Endpoint: "http://" + l.Addr().String() + "/credential", Nonce: model.ID() + model.ID(), listener: l, done: make(chan struct{})}
	mux := http.NewServeMux()
	mux.HandleFunc("/credential", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != "POST" || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+c.Nonce)) != 1 {
			http.Error(w, "denied", 403)
			return
		}
		var req CredentialRequest
		if json.NewDecoder(io.LimitReader(r.Body, 8192)).Decode(&req) != nil || req.Protocol != "https" || req.Host != "github.com" || strings.ToLower(strings.TrimSuffix(strings.Trim(req.Path, "/"), ".git")) != target {
			http.Error(w, "denied", 403)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"username": login, "password": token})
	})
	c.server = &http.Server{Handler: mux, ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 3 * time.Second, WriteTimeout: 3 * time.Second, IdleTimeout: 3 * time.Second}
	go func() { _ = c.server.Serve(l) }()
	go func() {
		select {
		case <-c.done:
			return
		case <-ctx.Done():
			c.Close()
		case <-time.After(24 * time.Hour):
			c.Close()
		}
	}()
	return c, nil
}
func (c *CredentialServer) Close() { c.once.Do(func() { close(c.done); _ = c.server.Close() }) }

// HelperMain is a non-UI mode of the same executable. Its environment contains
// only a per-command IPC nonce, never the GitHub token.
func HelperMain(args []string) int {
	if len(args) == 0 || args[0] != "get" {
		return 0
	}
	req := CredentialRequest{}
	scanner := bufio.NewScanner(io.LimitReader(os.Stdin, 8192))
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			break
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		switch key {
		case "protocol":
			req.Protocol = value
		case "host":
			req.Host = value
		case "path":
			req.Path = value
		}
	}
	endpoint := os.Getenv("BERTH_CREDENTIAL_ENDPOINT")
	nonce := os.Getenv("BERTH_CREDENTIAL_NONCE")
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" || u.Path != "/credential" || u.User != nil || u.RawQuery != "" || nonce == "" {
		return 1
	}
	data, _ := json.Marshal(req)
	r, err := http.NewRequest("POST", endpoint, strings.NewReader(string(data)))
	if err != nil {
		return 1
	}
	r.Header.Set("Authorization", "Bearer "+nonce)
	client := http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(r)
	if err != nil {
		return 1
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return 1
	}
	var credential map[string]string
	if json.NewDecoder(io.LimitReader(resp.Body, 8192)).Decode(&credential) != nil {
		return 1
	}
	if strings.ContainsAny(credential["username"]+credential["password"], "\r\n") {
		return 1
	}
	fmt.Fprintf(os.Stdout, "username=%s\npassword=%s\n\n", credential["username"], credential["password"])
	return 0
}
