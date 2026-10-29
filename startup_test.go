package main

import (
	"errors"
	"strings"
	"testing"

	"repo-berth/internal/model"
)

func TestStartupFailureDoesNotExposeRawDatabaseErrorsOrInjectPaths(t *testing.T) {
	page := startupErrorHTML(`D:\data\<script>alert(1)</script>\berth.db`, errors.New("raw database error: private-provider-payload"))
	if strings.Contains(page, "private-provider-payload") || strings.Contains(page, "<script>alert(1)</script>") {
		t.Fatal("startup recovery exposed untrusted content")
	}
	if !strings.Contains(page, "STORAGE_OPEN") || !strings.Contains(page, "&lt;script&gt;") {
		t.Fatal("startup error missing safe diagnostics")
	}
}
func TestStartupFailurePreservesUnsupportedVersionExplanation(t *testing.T) {
	page := startupErrorHTML("state.db", model.Err("SCHEMA_UNSUPPORTED", "数据库版本 99 不受支持"))
	if !strings.Contains(page, "SCHEMA_UNSUPPORTED") || !strings.Contains(page, "99") {
		t.Fatal("version recovery guidance missing")
	}
}
