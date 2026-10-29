package gitexec

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/cgi"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

// Real Git smart-HTTP, TLS and the production credential-helper executable are
// exercised together. Only this command's proxy/CA settings redirect github.com
// to a local fixture; no DNS, trust store or global Git settings are changed.
func TestHTTPSDualAccountTransport(t *testing.T) {
	// A user's proxy bypass list must never turn this fixture into a request
	// to the public service. Git/curl honours both spellings.
	t.Setenv("NO_PROXY", "")
	t.Setenv("no_proxy", "")
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	root := t.TempDir()
	seed := initRepo(t)
	if err := os.WriteFile(filepath.Join(seed, "README.md"), []byte("seed\n"), 0600); err != nil {
		t.Fatal(err)
	}
	testGit(t, seed, "add", ".")
	testGit(t, seed, "-c", "user.name=Seed", "-c", "user.email=seed@example.test", "commit", "-m", "seed")
	for _, owner := range []string{"personal", "work"} {
		bare := filepath.Join(root, owner, "private.git")
		if err := os.MkdirAll(filepath.Dir(bare), 0700); err != nil {
			t.Fatal(err)
		}
		testGit(t, root, "clone", "--bare", seed, bare)
		testGit(t, bare, "config", "http.receivepack", "true")
	}
	backend := filepath.Join(testGit(t, root, "--exec-path"), "git-http-backend")
	if runtime.GOOS == "windows" {
		backend += ".exe"
	}
	if _, err := os.Stat(backend); err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	accepted := map[string]int{}
	denied := 0
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		owner := strings.Split(strings.TrimPrefix(req.URL.Path, "/"), "/")[0]
		login, token, ok := req.BasicAuth()
		if !ok || (owner != "personal" && owner != "work") || login != owner || token != owner+"-synthetic-secret" {
			mu.Lock()
			denied++
			mu.Unlock()
			w.Header().Set("WWW-Authenticate", `Basic realm="private repositories"`)
			http.Error(w, "authentication required", http.StatusUnauthorized)
			return
		}
		mu.Lock()
		accepted[owner]++
		mu.Unlock()
		handler := cgi.Handler{Path: backend, Dir: root, Env: []string{"GIT_PROJECT_ROOT=" + root, "GIT_HTTP_EXPORT_ALL=1", "REMOTE_USER=" + login}}
		handler.ServeHTTP(w, req)
	}))
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	cert := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "isolated Git fixture"}, DNSNames: []string{"github.com"}, NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, BasicConstraintsValid: true, IsCA: true}
	der, err := x509.CreateCertificate(rand.Reader, cert, cert, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	server.TLS = &tls.Config{Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}}, MinVersion: tls.VersionTLS12}
	server.StartTLS()
	defer server.Close()
	ca := filepath.Join(root, "fixture-ca.pem")
	if err := os.WriteFile(ca, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0600); err != nil {
		t.Fatal(err)
	}
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.Method != http.MethodConnect || req.Host != "github.com:443" {
			http.Error(w, "denied", 403)
			return
		}
		upstream, err := net.DialTimeout("tcp", server.Listener.Addr().String(), 5*time.Second)
		if err != nil {
			http.Error(w, "fixture unavailable", 502)
			return
		}
		client, buf, err := w.(http.Hijacker).Hijack()
		if err != nil {
			upstream.Close()
			return
		}
		defer client.Close()
		defer upstream.Close()
		_ = client.SetDeadline(time.Now().Add(30 * time.Second))
		_ = upstream.SetDeadline(time.Now().Add(30 * time.Second))
		_, _ = buf.WriteString("HTTP/1.1 200 Connection Established\r\n\r\n")
		_ = buf.Flush()
		done := make(chan struct{})
		go func() { _, _ = io.Copy(upstream, buf); _ = upstream.Close(); close(done) }()
		_, _ = io.Copy(client, upstream)
		_ = client.Close()
		<-done
	}))
	defer proxy.Close()
	transport := []string{"http.proxy=" + proxy.URL, "http.sslCAInfo=" + filepath.ToSlash(ca), "http.sslVerify=true"}
	if runtime.GOOS == "windows" {
		transport = append(transport, "http.sslBackend=openssl")
	}
	helper, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	runner := Runner{}
	t.Run("accounts", func(t *testing.T) {
		for _, owner := range []string{"personal", "work"} {
			t.Run(owner, func(t *testing.T) {
				t.Parallel()
				url := "https://github.com/" + owner + "/private.git"
				auth := Auth{URL: url, Login: owner, Token: owner + "-synthetic-secret", Helper: helper}
				path := filepath.Join(root, owner+" 中文 checkout")
				if _, err := runner.Run(ctx, root, &auth, transport, "clone", "--", url, path); err != nil {
					t.Error(owner, "clone:", err)
					return
				}
				// Scope fixture transport to this disposable clone for Network(),
				// which follows the same repository config rules as the product.
				for _, value := range transport {
					k, v, _ := strings.Cut(value, "=")
					testGit(t, path, "config", k, v)
				}
				if err := os.WriteFile(filepath.Join(path, "identity.txt"), []byte(owner), 0600); err != nil {
					t.Error(err)
					return
				}
				if err := runner.Stage(ctx, path, "identity.txt", true); err != nil {
					t.Error(err)
					return
				}
				if err := runner.Commit(ctx, path, "commit "+owner, owner, owner+"@example.test"); err != nil {
					t.Error(err)
					return
				}
				before := testGit(t, filepath.Join(root, owner, "private.git"), "rev-parse", "main")
				wrong := auth
				wrong.Login = "personal"
				if owner == "personal" {
					wrong.Login = "work"
				}
				wrong.Token = wrong.Login + "-synthetic-secret"
				if err := runner.Network(ctx, path, "push", "origin", wrong); err == nil {
					t.Error("wrong account push succeeded")
				}
				revoked := auth
				revoked.Token = "revoked-synthetic-secret"
				if err := runner.Network(ctx, path, "push", "origin", revoked); err == nil {
					t.Error("revoked token push succeeded")
				} else if strings.Contains(err.Error(), revoked.Token) {
					t.Error("authentication error exposed token")
				}
				if got := testGit(t, filepath.Join(root, owner, "private.git"), "rev-parse", "main"); got != before {
					t.Error("rejected push changed remote")
				}
				for _, op := range []string{"push", "fetch", "pull"} {
					if err := runner.Network(ctx, path, op, "origin", auth); err != nil {
						t.Error(owner, op, err)
						return
					}
				}
				bare := filepath.Join(root, owner, "private.git")
				if got := testGit(t, bare, "log", "-1", "--format=%an <%ae>|%cn <%ce>"); got != owner+" <"+owner+"@example.test>|"+owner+" <"+owner+"@example.test>" {
					t.Error("wrong published identity:", got)
				}
				if got := testGit(t, bare, "show", "main:identity.txt"); got != owner {
					t.Error("wrong published contents:", got)
				}
				// Another checkout publishes a new commit over the same TLS/auth
				// path. Fetch must leave HEAD alone and pull must fast-forward it.
				peer := filepath.Join(root, owner+" peer")
				if _, err := runner.Run(ctx, root, &auth, transport, "clone", "--", url, peer); err != nil {
					t.Fatal(err)
				}
				for _, value := range transport {
					k, v, _ := strings.Cut(value, "=")
					testGit(t, peer, "config", k, v)
				}
				if err := os.WriteFile(filepath.Join(peer, "incoming.txt"), []byte("remote "+owner), 0600); err != nil {
					t.Fatal(err)
				}
				if err := runner.Stage(ctx, peer, "incoming.txt", true); err != nil {
					t.Fatal(err)
				}
				if err := runner.Commit(ctx, peer, "incoming "+owner, owner, owner+"@example.test"); err != nil {
					t.Fatal(err)
				}
				if err := runner.Network(ctx, peer, "push", "origin", auth); err != nil {
					t.Fatal(err)
				}
				localHead := testGit(t, path, "rev-parse", "HEAD")
				remoteHead := testGit(t, peer, "rev-parse", "HEAD")
				if localHead == remoteHead {
					t.Fatal("fixture did not create new remote commit")
				}
				if err := runner.Network(ctx, path, "fetch", "origin", auth); err != nil {
					t.Fatal(err)
				}
				if got := testGit(t, path, "rev-parse", "HEAD"); got != localHead {
					t.Fatal("fetch changed local HEAD")
				}
				if got := testGit(t, path, "rev-parse", "origin/main"); got != remoteHead {
					t.Fatal("fetch did not update remote tracking ref")
				}
				if err := runner.Network(ctx, path, "pull", "origin", auth); err != nil {
					t.Fatal(err)
				}
				if got := testGit(t, path, "rev-parse", "HEAD"); got != remoteHead {
					t.Fatal("pull did not fast-forward")
				}
				if data, err := os.ReadFile(filepath.Join(path, "incoming.txt")); err != nil || string(data) != "remote "+owner {
					t.Fatalf("pull did not materialize remote file: %q %v", data, err)
				}
			})
		}
	})
	mu.Lock()
	defer mu.Unlock()
	if accepted["personal"] == 0 || accepted["work"] == 0 || denied == 0 {
		t.Errorf("transport not exercised: accepted=%v denied=%d", accepted, denied)
	}
}
