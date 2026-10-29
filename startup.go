package main

import (
	"bytes"
	"errors"
	"fmt"
	"html/template"
	"os"
	"path/filepath"
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
	"repo-berth/internal/model"
)

func startupErrorHTML(path string, err error) string {
	data := struct{ Path, Code, Message string }{Path: path, Code: "STORAGE_OPEN", Message: "本地数据库无法读取或写入。请检查目录权限、磁盘空间，或恢复已有备份后重新启动。"}
	var appErr *model.AppError
	if errors.As(err, &appErr) && appErr.Code == "SCHEMA_UNSUPPORTED" {
		data.Code = appErr.Code
		data.Message = appErr.Message
	}
	const page = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Repo Berth · 启动恢复</title><style>
*{box-sizing:border-box}body{margin:0;background:#f1f5f6;color:#13191d;font:14px/1.8 system-ui,"Microsoft YaHei",sans-serif;padding:40px}main{max-width:760px;margin:auto;padding:36px;background:#fff;border:1px solid #e8eaec;border-radius:16px}header{color:#1b6c80;font-size:16px;font-weight:600}h1{font-size:26px;font-weight:600;line-height:1.4;margin:22px 0 16px}h2{font-size:14px;font-weight:600;margin-top:26px}p{color:#5d656b;margin:12px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f7f8;padding:14px;border-radius:6px;font:13px/1.8 Consolas,monospace;user-select:text}.code{font-size:12px}small{font-size:12px;color:#5d656b}@media(max-width:680px){body{padding:20px}main{padding:24px}h1{font-size:22px}}</style></head><body><main><header>Repo Berth</header><h1>本地数据暂时无法打开</h1><p id="startup-message">{{.Message}}</p><h2>数据库位置</h2><pre id="database-path">{{.Path}}</pre><p>数据文件没有被自动删除。可通过窗口菜单“帮助 → 打开数据目录”定位文件，再检查权限或恢复备份。</p><small>关闭此窗口后，可以重新启动应用重试。</small><p class="code" id="error-code">{{.Code}}</p></main></body></html>`
	var out bytes.Buffer
	_ = template.Must(template.New("startup").Parse(page)).Execute(&out, data)
	return out.String()
}

func showStartupFailure(app *application.App, path string, err error) {
	menu := app.NewMenu()
	if runtime.GOOS == "darwin" {
		menu.AddRole(application.AppMenu)
	}
	menu.AddRole(application.EditMenu)
	help := menu.AddSubmenu("帮助")
	help.Add("打开数据目录").OnClick(func(*application.Context) { _ = app.Browser.OpenFile(filepath.Dir(path)) })
	help.Add("退出").OnClick(func(*application.Context) { app.Quit() })
	app.Menu.Set(menu)
	app.Window.NewWithOptions(application.WebviewWindowOptions{Title: "Repo Berth · 启动恢复", Width: 900, Height: 640, MinWidth: 640, MinHeight: 480, HTML: startupErrorHTML(path, err), UseApplicationMenu: true})
	if runErr := app.Run(); runErr != nil {
		fmt.Fprintln(os.Stderr, "启动恢复窗口无法打开:", runErr)
	}
}
