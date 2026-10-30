package model

import (
	"crypto/rand"
	"encoding/hex"
	"time"
)

func ID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
func Now() string { return time.Now().UTC().Format(time.RFC3339) }

type Account struct {
	ID            string `json:"id"`
	Provider      string `json:"provider"`
	Host          string `json:"host"`
	UserID        int64  `json:"userId"`
	Login         string `json:"login"`
	Name          string `json:"name"`
	Avatar        string `json:"avatar"`
	Note          string `json:"note"`
	Color         string `json:"color"`
	CredentialRef string `json:"credentialRef"`
	Status        string `json:"status"`
	SessionOnly   bool   `json:"sessionOnly"`
	SyncedAt      string `json:"syncedAt"`
}
type CommitProfile struct {
	ID        string `json:"id"`
	AccountID string `json:"accountId"`
	Name      string `json:"name"`
	Email     string `json:"email"`
}
type RemoteRepository struct {
	ID          string `json:"id"`
	Provider    string `json:"provider"`
	Host        string `json:"host"`
	PlatformID  int64  `json:"platformId"`
	Owner       string `json:"owner"`
	Name        string `json:"name"`
	Description string `json:"description"`
	URL         string `json:"url"`
	CloneURL    string `json:"cloneUrl"`
	Private     bool   `json:"private"`
	Language    string `json:"language"`
	UpdatedAt   string `json:"updatedAt"`
	Favorite    bool   `json:"favorite"`
	LastOpened  string `json:"lastOpened"`
}
type AccountRepository struct {
	ID           string `json:"id"`
	AccountID    string `json:"accountId"`
	RepositoryID string `json:"repositoryId"`
	Push         bool   `json:"push"`
	SyncedAt     string `json:"syncedAt"`
}
type LocalCheckout struct {
	PlainDirectory bool             `json:"plainDirectory"`
	CommitName     string           `json:"commitName"`
	CommitEmail    string           `json:"commitEmail"`
	ID             string           `json:"id"`
	Path           string           `json:"path"`
	Name           string           `json:"name"`
	RepositoryID   string           `json:"repositoryId"`
	LastOpened     string           `json:"lastOpened"`
	Favorite       bool             `json:"favorite"`
	Remotes        []CheckoutRemote `json:"remotes"`
}
type CheckoutRemote struct {
	PushURL string `json:"pushUrl,omitempty"`
	Name    string `json:"name"`
	URL     string `json:"url"`
}
type RepositoryBinding struct {
	Automatic  bool   `json:"automatic,omitempty"`
	ID         string `json:"id"`
	CheckoutID string `json:"checkoutId"`
	Remote     string `json:"remote"`
	AccountID  string `json:"accountId"`
	ProfileID  string `json:"profileId"`
	RemoteURL  string `json:"remoteUrl"`
	PushURL    string `json:"pushUrl"`
}
type Group struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Members []string `json:"members"`
}
type Task struct {
	ID                             string        `json:"id"`
	Kind                           string        `json:"kind"`
	Target                         string        `json:"target"`
	State                          string        `json:"state"`
	Progress                       string        `json:"progress"`
	ErrorCode                      string        `json:"errorCode"`
	Error                          string        `json:"error"`
	StartedAt                      string        `json:"startedAt"`
	FinishedAt                     string        `json:"finishedAt"`
	Logs                           []TaskLog     `json:"logs"`
	CanResumeAuthorization         bool          `json:"canResumeAuthorization"`
	AuthorizationRecoveryExpiresAt string        `json:"authorizationRecoveryExpiresAt,omitempty"`
	CloneRequest                   *CloneRequest `json:"cloneRequest,omitempty"`
	ScanSummary                    *ScanSummary  `json:"scanSummary,omitempty"`
}
type ScanIssue struct {
	Path string `json:"path"`
	Code string `json:"code"`
}
type ScanSummary struct {
	Imported int         `json:"imported"`
	Skipped  int         `json:"skipped"`
	Issues   []ScanIssue `json:"issues"`
}

// CloneRequest retains non-secret confirmation fields for an explicit retry.
// Credentials are resolved again when a new task is submitted.
type CloneRequest struct {
	AccountID   string `json:"accountId"`
	ProfileID   string `json:"profileId"`
	Destination string `json:"destination"`
	URL         string `json:"url,omitempty"`
}
type TaskLog struct {
	At      string `json:"at"`
	Message string `json:"message"`
}
type Settings struct {
	DefaultAccountID   string `json:"defaultAccountId"`
	DefaultCommitName  string `json:"defaultCommitName"`
	DefaultCommitEmail string `json:"defaultCommitEmail"`
	ClientID           string `json:"clientId"`
	GitPath            string `json:"gitPath"`
	CloneDirectory     string `json:"cloneDirectory"`
	EditorPath         string `json:"editorPath"`
	AutoUpdateDisabled bool   `json:"autoUpdateDisabled"`
}
type State struct {
	GitHubAuthConfigured          bool                `json:"githubAuthConfigured"`
	Accounts                      []Account           `json:"accounts"`
	Profiles                      []CommitProfile     `json:"profiles"`
	Repositories                  []RemoteRepository  `json:"repositories"`
	Access                        []AccountRepository `json:"access"`
	Checkouts                     []LocalCheckout     `json:"checkouts"`
	Bindings                      []RepositoryBinding `json:"bindings"`
	Groups                        []Group             `json:"groups"`
	Tasks                         []Task              `json:"tasks"`
	Settings                      Settings            `json:"settings"`
	CredentialCleanup             []string            `json:"credentialCleanup,omitempty"`
	PendingCredentialCleanupCount int                 `json:"pendingCredentialCleanupCount"`
}

func EmptyState() State {
	return State{Accounts: []Account{}, Profiles: []CommitProfile{}, Repositories: []RemoteRepository{}, Access: []AccountRepository{}, Checkouts: []LocalCheckout{}, Bindings: []RepositoryBinding{}, Groups: []Group{}, Tasks: []Task{}, Settings: Settings{GitPath: "git"}}
}

type AppError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *AppError) Error() string    { return e.Code + ": " + e.Message }
func Err(code, message string) error { return &AppError{Code: code, Message: message} }
