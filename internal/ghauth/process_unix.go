//go:build !windows

package ghauth

import "os/exec"

func hideWindow(*exec.Cmd) {}
