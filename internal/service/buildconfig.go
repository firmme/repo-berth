package service

import "strings"

// GitHubOAuthClientID is the application's public OAuth identifier, provided by
// the publisher at build time. It is not a user credential or a client secret.
var GitHubOAuthClientID string

func effectiveGitHubClientID(legacy string) string {
	if configured := strings.TrimSpace(GitHubOAuthClientID); configured != "" {
		return configured
	}
	// Preserve developer/test configurations and settings from earlier builds.
	return strings.TrimSpace(legacy)
}
