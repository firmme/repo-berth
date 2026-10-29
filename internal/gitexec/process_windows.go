package gitexec

import (
	"os"
	"os/exec"
	"strconv"
	"syscall"
)

func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if cmd.Cancel != nil {
		cmd.Cancel = func() error {
			if cmd.Process == nil {
				return os.ErrProcessDone
			}
			killer := exec.Command("taskkill.exe", "/PID", strconv.Itoa(cmd.Process.Pid), "/T", "/F")
			killer.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
			if err := killer.Run(); err != nil {
				return cmd.Process.Kill()
			}
			return nil
		}
	}
}
