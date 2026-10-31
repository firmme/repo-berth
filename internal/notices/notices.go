package notices

import (
	"bytes"
	"compress/gzip"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"sync"
)

//go:embed notices.json.gz
var files embed.FS

type License struct {
	File   string `json:"file"`
	Source string `json:"source"`
	SHA256 string `json:"sha256"`
	Text   string `json:"text"`
}

type Dependency struct {
	Ecosystem       string    `json:"ecosystem"`
	Name            string    `json:"name"`
	Version         string    `json:"version"`
	DeclaredLicense string    `json:"declaredLicense,omitempty"`
	Repository      string    `json:"repository,omitempty"`
	Provenance      string    `json:"provenance,omitempty"`
	Licenses        []License `json:"licenses"`
}

type Inventory struct {
	SchemaVersion int               `json:"schemaVersion"`
	Version       string            `json:"version"`
	GeneratedAt   string            `json:"generatedAt"`
	Links         map[string]string `json:"links"`
	Dependencies  []Dependency      `json:"dependencies"`
	Compressed    int               `json:"compressed"`
}

var (
	once      sync.Once
	cached    Inventory
	loadError error
)

func Load() (Inventory, error) {
	once.Do(func() {
		raw, err := files.ReadFile("notices.json.gz")
		if err != nil {
			loadError = err
			return
		}
		reader, err := gzip.NewReader(bytes.NewReader(raw))
		if err != nil {
			loadError = err
			return
		}
		defer reader.Close()
		data, err := io.ReadAll(reader)
		if err != nil {
			loadError = err
			return
		}
		if err = json.Unmarshal(data, &cached); err != nil {
			loadError = err
			return
		}
		cached.Compressed = len(raw)
	})
	return cached, loadError
}

func (inventory Inventory) Text() string {
	var out strings.Builder
	fmt.Fprintf(&out, "Repo Berth %s third-party notices\nGenerated: %s\n\n", inventory.Version, inventory.GeneratedAt)
	for _, dependency := range inventory.Dependencies {
		fmt.Fprintf(&out, "%s: %s @ %s\n", dependency.Ecosystem, dependency.Name, dependency.Version)
		if dependency.DeclaredLicense != "" {
			fmt.Fprintf(&out, "Declared license: %s\n", dependency.DeclaredLicense)
		}
		if dependency.Repository != "" {
			fmt.Fprintf(&out, "Repository: %s\n", dependency.Repository)
		}
		if dependency.Provenance != "" {
			fmt.Fprintf(&out, "Note: %s\n", dependency.Provenance)
		}
		for _, license := range dependency.Licenses {
			fmt.Fprintf(&out, "\n--- %s (%s) ---\n%s\n", license.Source, license.SHA256, license.Text)
		}
		out.WriteString("\n")
	}
	return out.String()
}
