package main

import (
	"crypto/sha256"
	"embed"
	"flag"
	"fmt"
	"github.com/wailsapp/wails/v3/pkg/application"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"repo-berth/internal/gitexec"
	"repo-berth/internal/provider"
	"repo-berth/internal/service"
	"repo-berth/internal/vault"
	"runtime"
)

//go:embed all:frontend/dist
var frontend embed.FS

//go:embed assets/app-icon.png
var appIcon []byte

type desktop struct{ app *application.App }

func (d desktop) OpenURL(url string) error { return d.app.Browser.OpenURL(url) }
func (d desktop) PickDirectory() (string, error) {
	return d.app.Dialog.OpenFile().CanChooseFiles(false).CanChooseDirectories(true).CanCreateDirectories(true).SetTitle("选择仓库目录").PromptForSingleSelection()
}
func (d desktop) OpenPath(path, kind, editor string) error {
	if kind == "folder" || kind == "default" {
		return d.app.Browser.OpenFile(path)
	}
	if kind == "reveal" {
		return revealPath(path)
	}
	if kind == "editor" || kind == "vscode" {
		if kind == "vscode" || editor == "" {
			editor = findVSCode()
		}
		cmd := exec.Command(editor, path)
		return startExternal(cmd)
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("powershell.exe", "-NoLogo", "-NoExit")
	case "darwin":
		cmd = exec.Command("open", "-a", "Terminal", path)
	default:
		cmd = exec.Command("x-terminal-emulator")
	}
	cmd.Dir = path
	return startExternal(cmd)
}

func findVSCode() string {
	if runtime.GOOS == "windows" {
		for _, candidate := range []string{filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "Microsoft VS Code", "Code.exe"), filepath.Join(os.Getenv("ProgramFiles"), "Microsoft VS Code", "Code.exe")} {
			if _, err := os.Stat(candidate); err == nil {
				return candidate
			}
		}
	}
	return "code"
}

func revealPath(path string) error {
	info, err := os.Stat(path)
	isDir := err == nil && info.IsDir()
	switch runtime.GOOS {
	case "windows":
		if isDir {
			return startExternal(exec.Command("explorer.exe", path))
		}
		return startExternal(exec.Command("explorer.exe", "/select,"+path))
	case "darwin":
		args := []string{"-R", path}
		if isDir {
			args = []string{path}
		}
		return startExternal(exec.Command("open", args...))
	default:
		target := path
		if !isDir {
			target = filepath.Dir(path)
		}
		return startExternal(exec.Command("xdg-open", target))
	}
}
func startExternal(cmd *exec.Cmd) error {
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}
func main() {
	if len(os.Args) > 1 && os.Args[1] == "--credential-helper" {
		os.Exit(gitexec.HelperMain(os.Args[2:]))
	}
	debugPort := flag.Int("devtools-port", 0, "Enable local WebView debugging on this port (development only)")
	flag.Parse()
	path, err := service.DatabasePath()
	if err != nil {
		log.Fatal("无法定位应用数据目录")
	}
	assets, err := fs.Sub(frontend, "frontend/dist")
	if err != nil {
		log.Fatal(err)
	}
	instanceID := fmt.Sprintf("dev.repoberth.desktop.d%x", sha256.Sum256([]byte(path)))
	var mainWindow *application.WebviewWindow
	var svc *service.Service
	var updaterReady bool
	var app *application.App
	options := application.Options{Name: "Repo Berth", Description: "多账号 Git 仓库工作台", Icon: appIcon, SingleInstance: &application.SingleInstanceOptions{UniqueID: instanceID, OnSecondInstanceLaunch: func(application.SecondInstanceData) {
		if mainWindow != nil {
			mainWindow.Show()
			mainWindow.Focus()
		}
		if app != nil {
			app.Event.Emit("app:second-instance", nil)
		}
	}}, Assets: application.AssetOptions{Handler: application.AssetFileServerFS(assets)}, Mac: application.MacOptions{ApplicationShouldTerminateAfterLastWindowClosed: true}}
	if *debugPort > 0 && *debugPort < 65536 {
		options.Windows.AdditionalBrowserArgs = []string{fmt.Sprintf("--remote-debugging-port=%d", *debugPort)}
	}
	app = application.New(options)
	updaterReady = configureUpdater(app)
	if runtime.GOOS == "darwin" {
		installMacMenu(app, func(name string, data any) { app.Event.Emit(name, data) })
	}
	// Acquire the native single-instance lock before touching persisted state.
	svc, err = service.New(path, provider.NewGitHub(), vault.New())
	if err != nil {
		showStartupFailure(app, path, err)
		return
	}
	app.RegisterService(application.NewService(svc))
	service.Attach(svc, desktop{app}, func(name string, data any) { app.Event.Emit(name, data) })
	mainWindow = app.Window.NewWithOptions(application.WebviewWindowOptions{Title: "Repo Berth · 仓库工作台", Width: 1440, Height: 920, MinWidth: 900, MinHeight: 640, Frameless: runtime.GOOS == "windows", URL: "/"})
	if updaterReady {
		service.AttachUpdater(svc, func() { startUpdateCheck(app) })
		attachAutoUpdateTrigger(app, svc.AutoUpdateEnabled)
	}
	app.OnShutdown(func() { service.Close(svc) })
	if err = app.Run(); err != nil {
		fmt.Fprintln(os.Stderr, "应用启动失败:", err)
		os.Exit(1)
	}
}
