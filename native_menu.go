package main

import (
	"github.com/wailsapp/wails/v3/pkg/application"
)

// installMacMenu installs the native macOS menu bar. Menu commands are sent to
// the React layer so they share the same state and confirmation flows as the
// in-window controls.
func installMacMenu(app *application.App, emit func(string, any)) {
	action := func(id string) func(*application.Context) {
		return func(*application.Context) { emit("menu:action", id) }
	}
	role := func(menu *application.Menu, item application.Role, label, accelerator string) {
		entry := menu.Add(label).SetRole(item)
		if accelerator != "" {
			entry.SetAccelerator(accelerator)
		}
	}

	menu := app.NewMenu()

	appMenu := menu.AddSubmenu("Repo Berth")
	appMenu.Add("关于 Repo Berth").OnClick(action("app.about"))
	appMenu.AddSeparator()
	appMenu.Add("设置…").SetAccelerator("CmdOrCtrl+,").OnClick(action("app.settings"))
	appMenu.AddSeparator()
	role(appMenu, application.Hide, "隐藏 Repo Berth", "CmdOrCtrl+H")
	role(appMenu, application.HideOthers, "隐藏其他", "CmdOrCtrl+OptionOrAlt+H")
	role(appMenu, application.UnHide, "全部显示", "")
	appMenu.AddSeparator()
	role(appMenu, application.Quit, "退出 Repo Berth", "CmdOrCtrl+Q")

	file := menu.AddSubmenu("文件")
	file.Add("添加本地仓库…").SetAccelerator("CmdOrCtrl+O").OnClick(action("file.import"))
	file.Add("管理本地目录…").OnClick(action("file.manage-local"))
	file.Add("克隆仓库…").SetAccelerator("CmdOrCtrl+Shift+O").OnClick(action("file.clone"))
	file.AddSeparator()
	role(file, application.CloseWindow, "关闭窗口", "CmdOrCtrl+W")

	edit := menu.AddSubmenu("编辑")
	role(edit, application.Undo, "撤销", "CmdOrCtrl+Z")
	role(edit, application.Redo, "重做", "CmdOrCtrl+Shift+Z")
	edit.AddSeparator()
	role(edit, application.Cut, "剪切", "CmdOrCtrl+X")
	role(edit, application.Copy, "复制", "CmdOrCtrl+C")
	role(edit, application.Paste, "粘贴", "CmdOrCtrl+V")
	role(edit, application.SelectAll, "全选", "CmdOrCtrl+A")
	edit.AddSeparator()
	edit.Add("在编辑器中打开").SetAccelerator("CmdOrCtrl+Shift+E").OnClick(action("edit.open-editor"))
	edit.Add("复制本地路径").SetAccelerator("CmdOrCtrl+Shift+C").OnClick(action("edit.copy-path"))

	view := menu.AddSubmenu("视图")
	view.Add("变更").SetAccelerator("CmdOrCtrl+1").OnClick(action("view.changes"))
	view.Add("历史").SetAccelerator("CmdOrCtrl+2").OnClick(action("view.history"))
	view.Add("刷新仓库状态").SetAccelerator("CmdOrCtrl+R").OnClick(action("view.refresh"))
	view.Add("自动换行").OnClick(action("view.wrap"))
	view.Add("任务中心").SetAccelerator("CmdOrCtrl+Shift+T").OnClick(action("view.tasks"))
	view.AddSeparator()
	theme := view.AddSubmenu("主题")
	themeItems := map[string]*application.MenuItem{
		"system": theme.AddRadio("跟随系统", true).OnClick(action("view.theme.system")),
		"light":  theme.AddRadio("日间", false).OnClick(action("view.theme.light")),
		"dark":   theme.AddRadio("暗黑", false).OnClick(action("view.theme.dark")),
	}
	app.Event.On("menu:theme", func(event *application.CustomEvent) {
		current, _ := event.Data.(string)
		for name, item := range themeItems {
			item.SetChecked(name == current)
		}
	})
	view.AddSeparator()
	role(view, application.ToggleFullscreen, "切换全屏", "Ctrl+Command+F")

	repository := menu.AddSubmenu("仓库")
	repository.Add("使用 VS Code 打开项目").OnClick(action("repository.open-vscode"))
	repository.Add("在文件夹中打开").OnClick(action("repository.open-folder"))
	repository.Add("在 GitHub 中查看").OnClick(action("repository.open-github"))
	repository.Add("分享到 GitHub…").OnClick(action("repository.share"))
	repository.Add("仓库设置…").OnClick(action("repository.settings"))
	repository.AddSeparator()
	repository.Add("收藏仓库").OnClick(action("repository.favorite"))

	branch := menu.AddSubmenu("分支")
	branch.Add("切换或新建分支…").SetAccelerator("CmdOrCtrl+B").OnClick(action("branch.switch"))

	update := menu.AddSubmenu("更新")
	update.Add("检查更新…").SetAccelerator("CmdOrCtrl+Shift+U").OnClick(action("update.check"))

	window := menu.AddSubmenu("窗口")
	role(window, application.Minimise, "最小化", "CmdOrCtrl+M")
	role(window, application.Zoom, "缩放", "")
	window.AddSeparator()
	role(window, application.BringAllToFront, "前置全部窗口", "")

	help := menu.AddSubmenu("帮助")
	help.Add("账号与身份…").OnClick(action("help.accounts"))
	help.Add("关于 Repo Berth").OnClick(action("help.about"))

	app.Menu.Set(menu)
}
