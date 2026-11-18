package ghauth

import (
	"io"
	"strings"
	"testing"
)

func TestDeviceCodeWriterOnlyPublishesCodeAcrossWrites(t *testing.T) {
	var codes []string
	w := &codeWriter{onCode: func(code string) { codes = append(codes, code) }}
	for _, chunk := range []string{"secret-diagnostic First copy your one-time code: AB", "CD-EFGH\n", "token=private-token"} {
		if _, err := w.Write([]byte(chunk)); err != nil {
			t.Fatal(err)
		}
	}
	if len(codes) != 1 || codes[0] != "ABCD-EFGH" || w.text != "" {
		t.Fatal("raw CLI output retained or code not published once")
	}
}

func TestEnvironmentCannotOverrideSelectedCLIIdentity(t *testing.T) {
	for _, key := range []string{"GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN", "GH_DEBUG"} {
		t.Setenv(key, "must-not-inherit")
	}
	for _, item := range environment() {
		if strings.Contains(item, "must-not-inherit") {
			t.Fatal("inherited token/debug variable can override or expose selected credentials")
		}
	}
}

func TestLimitedOutputAlsoBoundsIOCopy(t *testing.T) {
	var b limitedBuffer
	if _, err := io.Copy(&b, strings.NewReader(strings.Repeat("x", 2<<20))); err == nil {
		t.Fatal("unbounded CLI output accepted")
	}
}
