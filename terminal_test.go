package main

import (
	"reflect"
	"testing"
)

func TestTerminalLaunchDefaultsPerPlatform(t *testing.T) {
	path := `C:\Projects\demo repo`
	tests := []struct {
		goos string
		want terminalLaunch
	}{
		{"windows", terminalLaunch{"powershell.exe", []string{"-NoLogo", "-NoExit"}, path}},
		{"darwin", terminalLaunch{"open", []string{"-a", "Terminal", path}, path}},
		{"linux", terminalLaunch{"x-terminal-emulator", nil, path}},
	}
	for _, test := range tests {
		if got := terminalLaunchFor(test.goos, path, ""); !reflect.DeepEqual(got, test.want) {
			t.Fatalf("%s default = %+v, want %+v", test.goos, got, test.want)
		}
	}
}

func TestTerminalLaunchConfiguredPrograms(t *testing.T) {
	path := `/home/me/demo repo`
	tests := []struct {
		name     string
		goos     string
		terminal string
		want     terminalLaunch
	}{
		{"windows terminal", "windows", `C:\Program Files\WindowsApps\wt.exe`, terminalLaunch{`C:\Program Files\WindowsApps\wt.exe`, []string{"-d", path}, path}},
		{"quoted windows terminal", "windows", `"C:\Program Files\WindowsApps\wt.exe"`, terminalLaunch{`C:\Program Files\WindowsApps\wt.exe`, []string{"-d", path}, path}},
		{"powershell 7", "windows", `C:\Program Files\PowerShell\7\pwsh.exe`, terminalLaunch{`C:\Program Files\PowerShell\7\pwsh.exe`, []string{"-NoLogo", "-NoExit"}, path}},
		{"command prompt", "windows", "cmd.exe", terminalLaunch{"cmd.exe", nil, path}},
		{"unknown windows terminal", "windows", `C:\Tools\MyTerm.exe`, terminalLaunch{`C:\Tools\MyTerm.exe`, nil, path}},
		{"mac app bundle", "darwin", "/Applications/iTerm.app", terminalLaunch{"open", []string{"-a", "/Applications/iTerm.app", path}, path}},
		{"mac app name", "darwin", "iTerm", terminalLaunch{"open", []string{"-a", "iTerm", path}, path}},
		{"mac cli terminal", "darwin", "alacritty", terminalLaunch{"alacritty", nil, path}},
		{"gnome terminal", "linux", "/usr/bin/gnome-terminal", terminalLaunch{"/usr/bin/gnome-terminal", []string{"--working-directory=" + path}, path}},
		{"konsole", "linux", "konsole", terminalLaunch{"konsole", []string{"--workdir", path}, path}},
		{"alacritty", "linux", "alacritty", terminalLaunch{"alacritty", []string{"--working-directory", path}, path}},
		{"kitty", "linux", "kitty", terminalLaunch{"kitty", []string{"--directory", path}, path}},
		{"wezterm", "linux", "wezterm", terminalLaunch{"wezterm", []string{"start", "--cwd", path}, path}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := terminalLaunchFor(test.goos, path, test.terminal); !reflect.DeepEqual(got, test.want) {
				t.Fatalf("launch = %+v, want %+v", got, test.want)
			}
		})
	}
}
