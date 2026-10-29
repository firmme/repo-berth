package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"repo-berth/internal/model"
	"strconv"
	"strings"
	"time"
)

type DeviceCode struct {
	DeviceCode      string `json:"device_code"`
	UserCode        string `json:"user_code"`
	VerificationURI string `json:"verification_uri"`
	ExpiresIn       int    `json:"expires_in"`
	Interval        int    `json:"interval"`
}
type User struct {
	ID     int64  `json:"id"`
	Login  string `json:"login"`
	Name   string `json:"name"`
	Avatar string `json:"avatar_url"`
}
type Email struct {
	Email    string `json:"email"`
	Primary  bool   `json:"primary"`
	Verified bool   `json:"verified"`
}
type Repository struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	HTMLURL     string `json:"html_url"`
	CloneURL    string `json:"clone_url"`
	Private     bool   `json:"private"`
	Language    string `json:"language"`
	UpdatedAt   string `json:"updated_at"`
	Owner       struct {
		Login string `json:"login"`
	} `json:"owner"`
	Permissions struct {
		Push bool `json:"push"`
	} `json:"permissions"`
}
type Provider interface {
	StartDevice(context.Context, string) (DeviceCode, error)
	PollDevice(context.Context, string, DeviceCode) (string, error)
	CurrentUser(context.Context, string) (User, error)
	Emails(context.Context, string) ([]Email, error)
	Repositories(context.Context, string) ([]Repository, error)
}
type GitHub struct {
	Client *http.Client
	API    string
	OAuth  string
	wait   func(context.Context, time.Duration) error
}

func NewGitHub() *GitHub {
	return &GitHub{Client: &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, API: "https://api.github.com", OAuth: "https://github.com"}
}
func (g *GitHub) request(ctx context.Context, method, endpoint, token string, form url.Values, out any) error {
	var body io.Reader
	if form != nil {
		body = strings.NewReader(form.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return model.Err("NETWORK", "无法构建请求")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Repo-Berth/0.1")
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	}
	resp, err := g.Client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return model.Err("NETWORK", "无法连接 GitHub，请检查网络或代理设置")
	}
	defer resp.Body.Close()
	if resp.StatusCode == 401 {
		return model.Err("AUTH_REQUIRED", "GitHub 授权已失效，请重新授权")
	}
	if resp.StatusCode == 429 || (resp.StatusCode == 403 && (resp.Header.Get("X-RateLimit-Remaining") == "0" || resp.Header.Get("Retry-After") != "")) {
		return model.Err("RATE_LIMIT", "GitHub 请求受限，请稍后重试")
	}
	if resp.StatusCode == 403 {
		return model.Err("PERMISSION", "GitHub 拒绝访问，请检查仓库权限及组织 SSO 授权")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return model.Err("PROVIDER", "GitHub 返回异常状态 "+strconv.Itoa(resp.StatusCode))
	}
	if err = json.NewDecoder(io.LimitReader(resp.Body, 16<<20)).Decode(out); err != nil {
		return model.Err("PROVIDER", "GitHub 响应格式异常")
	}
	return nil
}
func (g *GitHub) StartDevice(ctx context.Context, client string) (DeviceCode, error) {
	var d DeviceCode
	err := g.request(ctx, "POST", g.OAuth+"/login/device/code", "", url.Values{"client_id": {client}, "scope": {"repo read:user user:email"}}, &d)
	if err != nil {
		return d, err
	}
	if d.DeviceCode == "" || d.UserCode == "" || d.ExpiresIn <= 0 || d.VerificationURI != "https://github.com/login/device" {
		return d, model.Err("AUTH_FAILED", "GitHub 未返回有效的设备授权信息")
	}
	return d, nil
}
func (g *GitHub) PollDevice(ctx context.Context, client string, d DeviceCode) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, time.Duration(d.ExpiresIn)*time.Second)
	defer cancel()
	interval := time.Duration(max(d.Interval, 5)) * time.Second
	for {
		wait := g.wait
		if wait == nil {
			wait = func(ctx context.Context, d time.Duration) error {
				timer := time.NewTimer(d)
				defer timer.Stop()
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-timer.C:
					return nil
				}
			}
		}
		if wait(ctx, interval) != nil {
			if ctx.Err() == context.Canceled {
				return "", context.Canceled
			}
			return "", model.Err("AUTH_EXPIRED", "授权已取消或验证码已过期")
		}
		var result struct {
			Token string `json:"access_token"`
			Error string `json:"error"`
		}
		err := g.request(ctx, "POST", g.OAuth+"/login/oauth/access_token", "", url.Values{"client_id": {client}, "device_code": {d.DeviceCode}, "grant_type": {"urn:ietf:params:oauth:grant-type:device_code"}}, &result)
		if err != nil {
			return "", err
		}
		switch result.Error {
		case "authorization_pending":
			continue
		case "slow_down":
			interval += 5 * time.Second
			continue
		case "access_denied":
			return "", model.Err("AUTH_DENIED", "已拒绝 GitHub 授权")
		case "expired_token":
			return "", model.Err("AUTH_EXPIRED", "验证码已过期，请重新授权")
		case "":
			if result.Token != "" {
				return result.Token, nil
			}
		}
		return "", model.Err("AUTH_FAILED", "GitHub 授权失败，请检查 Client ID 和 Device Flow 设置")
	}
}
func (g *GitHub) CurrentUser(ctx context.Context, t string) (User, error) {
	var u User
	err := g.request(ctx, "GET", g.API+"/user", t, nil, &u)
	if err == nil && (u.ID <= 0 || u.Login == "") {
		err = model.Err("PROVIDER", "GitHub 用户信息不完整")
	}
	return u, err
}
func (g *GitHub) Emails(ctx context.Context, t string) ([]Email, error) {
	var e []Email
	err := g.request(ctx, "GET", g.API+"/user/emails", t, nil, &e)
	return e, err
}
func (g *GitHub) Repositories(ctx context.Context, t string) ([]Repository, error) {
	all := []Repository{}
	seen := map[int64]bool{}
	for page := 1; ; page++ {
		var batch []Repository
		err := g.request(ctx, "GET", fmt.Sprintf("%s/user/repos?per_page=100&page=%d&sort=updated&affiliation=owner,collaborator,organization_member", g.API, page), t, nil, &batch)
		if err != nil {
			return nil, err
		}
		for _, r := range batch {
			if !seen[r.ID] {
				all = append(all, r)
				seen[r.ID] = true
			}
		}
		if len(batch) < 100 {
			break
		}
		if page >= 10000 {
			return nil, model.Err("PROVIDER", "仓库分页超出限制")
		}
	}
	return all, nil
}

// Redact never returns provider response bodies, which can contain credentials.
func Redact(s string, secrets ...string) string {
	for _, secret := range secrets {
		if secret != "" {
			s = strings.ReplaceAll(s, secret, "[redacted]")
		}
	}
	return string(bytes.ToValidUTF8([]byte(s), []byte("?")))
}
