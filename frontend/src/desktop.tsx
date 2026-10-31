import { useEffect, useMemo, useRef, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  RefreshCw,
  ArrowDown,
  ArrowUp,
  FolderGit2,
  FolderOpen,
  Code2,
  ExternalLink,
  Search,
  UsersRound,
  Plus,
  Check,
  X,
  Settings2,
  GitCommitHorizontal,
  Clock3,
  Star,
  Activity,
  FileText,
  ArrowLeft,
  Minus,
  Square,
  Github,
  Folder,
  FilePlus2,
  Pencil,
  EyeOff,
  Trash2,
  Copy,
  Scissors,
  ClipboardPaste,
  FolderPlus,
  Terminal,
  Image as ImageIcon,
  Music,
  Video,
  FileQuestion,
  Eye,
  Save,
} from "lucide-react";
import { version } from "../package.json";
import { api, errorMessage, isDesktop, onAppActivated, onStateChanged } from "./api";
import {
  emptyState,
  type State,
  type Checkout,
  type FileStatus,
  type GitStatus,
  type Task,
  type RemoteCheck,
  type LineEndingRisk,
  type WorkingFileInfo,
  type WorkingFilePreview,
  type CommitBinaryDiff,
  type Branch,
  type Commit,
} from "./types";
import { rowsFromState, filterRows, type Execute, type Row } from "./catalog";
import { useUI } from "./ui";
import {
  LANGUAGES,
  detectLanguage,
  highlightCode,
  languageLabel,
  type LanguageId,
} from "./highlight";
import {
  Modal,
  Field,
  ErrorNotice,
  Loading,
  AccountAvatar,
  RepositoryMark,
} from "./components";
import { ScopePicker } from "./scope-picker";
import { AccountsView, SettingsView } from "./settings";
import { BindingModal, CloneForm, CloneURLForm, ShareForm } from "./repository";
import { ImportModal, TaskRow } from "./workspace-tools";
import {
  CheckoutIdentity,
  LocalManagement,
  effectiveCommitIdentity,
  resolveAccessAccount,
  githubRepositoryPath,
} from "./local-management";

type Popup =
  | ""
  | "repositories"
  | "branches"
  | "network"
  | "accounts"
  | "file"
  | "edit"
  | "view"
  | "repository"
  | "branch"
  | "update"
  | "help";
type Panel =
  | ""
  | "accounts"
  | "settings"
  | "repository"
  | "binding"
  | "import"
  | "clone"
  | "clone-url"
  | "local-management"
  | "forget"
  | "share"
  | "about";
type MenuNode = {
  label: string;
  action?: () => void;
  disabled?: boolean;
  hidden?: boolean;
  nativeAction?: string;
  children?: {
    label: string;
    action: () => void;
    checked?: boolean;
    nativeAction?: string;
  }[];
};
export default function Desktop() {
  const client = useQueryClient(),
    ui = useUI();
  const [popup, setPopup] = useState<Popup>(""),
    [panel, setPanel] = useState<Panel>("");
  const customTitlebar = isDesktop && navigator.userAgent.includes("Windows");
  const nativeMenubar =
    isDesktop && /Macintosh|Mac OS X/.test(navigator.userAgent);
  const windowCommand = (command: "Minimise" | "ToggleMaximise" | "Close") => {
    void import("@wailsio/runtime").then(({ Window }) => Window[command]());
  };
  const [copyID, setCopyID] = useState(""),
    [remoteChoices, setRemoteChoices] = useState<Record<string, string>>({}),
    [remoteCheck, setRemoteCheck] = useState<RemoteCheck>();
  const remoteCheckTimes = useRef<Record<string, number>>({});
  const checkRemoteUpdateRef = useRef<() => void>(() => {});
  const [cloneID, setCloneID] = useState(""),
    [cloneRequest, setCloneRequest] = useState<Task["cloneRequest"]>();
  const [theme, setTheme] = useState<"system" | "light" | "dark">(() => {
    const saved = localStorage.getItem("repo-berth-theme");
    return saved === "light" || saved === "dark" ? saved : "system";
  });
  const [tab, setTab] = useState<"changes" | "history">("changes");
  const [showCompletedTasks, setShowCompletedTasks] = useState(false);
  const [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [repositorySearch, setRepositorySearch] = useState("");
  const [branchSearch, setBranchSearch] = useState(""),
    [newBranch, setNewBranch] = useState(""),
    [collapsedBranchFolders, setCollapsedBranchFolders] = useState<Set<string>>(
      new Set(),
    );
  const [lastFetched, setLastFetched] = useState<Record<string, string>>({});
  const seenTasks = useRef<Set<string> | null>(null);
  const nativeCommands = useRef<Record<string, () => void>>({});
  const {
    data: st = emptyState,
    isPending: loading,
    isError,
  } = useQuery({
    queryKey: ["state"],
    queryFn: () => api("Snapshot"),
    refetchInterval: isDesktop ? 5000 : false,
  });
  const rows = rowsFromState(st);
  const selected =
    rows.find((r) => r.id === ui.selected) ||
    rows.find((r) => r.checkouts.some((c) => c.id === copyID));
  const checkout =
    selected?.checkouts.find((c) => c.id === copyID) || selected?.checkouts[0];
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || loading || ui.selected) return;
    restored.current = true;
    const used = rows.filter((r) => r.lastOpened && r.checkouts.length);
    if (!used.length) return;
    const row = used.reduce((a, b) =>
      b.lastOpened > a.lastOpened ? b : a,
    );
    const copy = row.checkouts.reduce(
      (a, b) => ((b.lastOpened || "") > (a.lastOpened || "") ? b : a),
      row.checkouts[0],
    );
    ui.set({ selected: row.id, view: "repositories" });
    if (copy) setCopyID(copy.id);
  }, [loading, rows, ui]);
  const status = useQuery({
    queryKey: ["git", "status", checkout?.id],
    queryFn: () => api("GitStatus", checkout!.id),
    enabled: !!checkout && !checkout.plainDirectory,
    refetchInterval: checkout ? 12000 : false,
  });
  const branches = useQuery({
    queryKey: ["git", "branches", checkout?.id],
    queryFn: () => api("GitBranches", checkout!.id),
    enabled:
      !!checkout &&
      !checkout.plainDirectory &&
      (popup === "branches" || popup === "branch"),
  });
  const environment = useQuery({
    queryKey: ["git", "environment", st.settings.gitPath],
    queryFn: () => api("GitVersion"),
    enabled: isDesktop,
    staleTime: 60000,
  });
  const remotes = status.data?.remotes || checkout?.remotes || [];
  const requestedRemote = remoteChoices[checkout?.id || ""] || "origin";
  const remote = remotes.some((r) => r.name === requestedRemote)
    ? requestedRemote
    : "";
  const tracking = status.data?.tracking?.find((t) => t.remote === remote);
  const githubPath = githubRepositoryPath(
    remotes.find((r) => r.name === remote)?.url || "",
  );
  const upstreamRemote = status.data?.upstream?.split("/")[0] || "";
  const matchingUpstream = !!remote && upstreamRemote === remote;
  const ahead = tracking?.ahead ?? (matchingUpstream ? status.data?.ahead ?? 0 : 0);
  const behind = tracking?.behind ?? (matchingUpstream ? status.data?.behind ?? 0 : 0);
  const lastFetch =
    lastFetched[checkout?.id || ""] ||
    st.tasks.find(
      (t) =>
        t.kind === "fetch" &&
        t.target === checkout?.id &&
        t.state === "succeeded",
    )?.finishedAt ||
    "";
  const statusUpdated = status.dataUpdatedAt
    ? new Date(status.dataUpdatedAt).toISOString()
    : "";
  const {
    account,
    profile,
    source: accessSource,
  } = resolveAccessAccount(st, checkout, remote);
  const busy =
    pending ||
    st.tasks.some(
      (t) =>
        t.target === checkout?.id && ["queued", "running"].includes(t.state),
    );
  const verifying = status.isPending || status.isFetching || status.isError;
  const networkDisabled =
    !checkout ||
    !!checkout.plainDirectory ||
    !remote ||
    !account ||
    account.status === "auth_required" ||
    busy ||
    verifying;
  const remoteHasUpdates =
    !!remoteCheck?.updated && remoteCheck.remote === remote;
  checkRemoteUpdateRef.current = () => {
    if (
      !isDesktop ||
      !checkout ||
      checkout.plainDirectory ||
      !remote ||
      busy ||
      status.isError
    )
      return;
    if (account?.status === "auth_required") return;
    const key = `${checkout.id}:${remote}`;
    const now = Date.now();
    if ((remoteCheckTimes.current[key] || 0) + 10000 > now) return;
    remoteCheckTimes.current[key] = now;
    void api("CheckRemoteUpdate", checkout.id, remote)
      .then((result) => {
        if (!result) return;
        setRemoteCheck((current) =>
          result.remote === remote ? result : current,
        );
      })
      .catch(() => {});
  };
  useEffect(() => {
    let off = () => {};
    let live = true;
    void onAppActivated(() => {
      checkRemoteUpdateRef.current();
      void client.invalidateQueries({ queryKey: ["git", "status"] });
      void client.invalidateQueries({ queryKey: ["state"] });
    }).then((dispose) => {
      if (live) off = dispose;
      else dispose();
    });
    return () => {
      live = false;
      off();
    };
  }, [client]);
  useEffect(() => {
    if (!loading) checkRemoteUpdateRef.current();
  }, [loading, checkout?.id, remote, busy]);
  useEffect(() => {
    setRemoteCheck(undefined);
  }, [checkout?.id, remote]);
  useEffect(() => {
    setRemoteCheck(undefined);
  }, [lastFetch]);
  const activeTasks = st.tasks.filter((t) =>
    ["queued", "running"].includes(t.state),
  );
  const execute: Execute = async (fn) => {
    setError("");
    setPending(true);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
      await client.invalidateQueries({ queryKey: ["state"] });
      await client.invalidateQueries({ queryKey: ["git"] });
    }
  };
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const apply = () => { document.documentElement.dataset.theme = theme === "system" ? (media?.matches ? "dark" : "light") : theme; };
    apply();
    media?.addEventListener("change", apply);
    localStorage.setItem("repo-berth-theme", theme);
    if (nativeMenubar)
      void import("@wailsio/runtime").then(({ Events }) =>
        Events.Emit("menu:theme", theme),
      );
    return () => media?.removeEventListener("change", apply);
  }, [theme, nativeMenubar]);
  useEffect(() => {
    let off = () => {};
    let live = true;
    void onStateChanged(
      () => void client.invalidateQueries({ queryKey: ["state"] }),
      () => void client.invalidateQueries({ queryKey: ["git"] }),
    ).then((f) => {
      if (live) off = f;
      else f();
    });
    return () => {
      live = false;
      off();
    };
  }, [client]);
  useEffect(() => {
    if (!nativeMenubar) return;
    let off = () => {};
    let live = true;
    void import("@wailsio/runtime").then(({ Events }) => {
      const unsubscribe = Events.On("menu:action", (event) => {
        const command = typeof event.data === "string" ? event.data : "";
        nativeCommands.current[command]?.();
      });
      if (live) off = unsubscribe;
      else unsubscribe();
    });
    return () => {
      live = false;
      off();
    };
  }, [nativeMenubar]);
  useEffect(() => {
    useUI.getState().settleCommitDrafts(st.tasks);
    if (!seenTasks.current) {
      if (!loading)
        seenTasks.current = new Set(
          st.tasks
            .filter((t) => !["queued", "running"].includes(t.state))
            .map((t) => t.id),
        );
      return;
    }
    for (const t of st.tasks) {
      if (
        ["queued", "running"].includes(t.state) ||
        seenTasks.current.has(t.id)
      )
        continue;
      seenTasks.current.add(t.id);
      if (t.state === "failed") setError(`${t.errorCode} · ${t.error}`);
      if (t.state === "succeeded" && t.kind === "fetch")
        setLastFetched((values) => ({ ...values, [t.target]: t.finishedAt }));
    }
  }, [st.tasks, ui.commitSubmissions, loading]);
  useEffect(() => {
    if (ui.view === "accounts") setPanel("accounts");
    if (ui.view === "settings") setPanel("settings");
  }, [ui.view]);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!(event.target as Element).closest("[data-desktop-popup]"))
        setPopup("");
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPopup("");
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPopup("repositories");
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
    };
  }, []);
  const show = (next: Panel) => {
    setPopup("");
    setPanel(next);
  };
  const closePanel = () => {
    setPanel("");
    ui.set({ view: "repositories" });
  };
  const choose = (row: Row, id?: string, chosenRemote?: string) => {
    setCopyID(id || row.checkouts[0]?.id || "");
    if (chosenRemote && id)
      setRemoteChoices((v) => ({ ...v, [id]: chosenRemote }));
    ui.set({ selected: row.id, view: "repositories" });
    setPopup("");
    setTab("changes");
    void api("MarkVisited", row.id).catch((e) => setError(errorMessage(e)));
    if (id && id !== row.id)
      void api("MarkVisited", id).catch((e) => setError(errorMessage(e)));
  };
  const openTarget = (target: string) => {
    const row = rows.find((r) => r.checkouts.some((c) => c.id === target));
    if (row) {
      ui.set({ scope: "all", query: "" });
      setRepositorySearch("");
      choose(row, target);
      ui.set({ tasksOpen: false });
    }
  };
  const chooseAccount = (id: string) => {
    setPopup("");
    void execute(() =>
      api(
        "SetAccessAccount",
        checkout && !checkout.plainDirectory ? checkout.id : "",
        remote,
        id,
      ),
    );
  };
  const clone = (row: Row, request?: Task["cloneRequest"]) => {
    setCloneID(row.id);
    setCloneRequest(request);
    show("clone");
  };
  const network = (operation: string) =>
    void execute(() => api("GitNetwork", checkout!.id, remote, operation));
  const remoteSelect = checkout && (
    <select
      aria-label="选择 remote"
      value={remote}
      onChange={(e) =>
        setRemoteChoices((v) => ({ ...v, [checkout.id]: e.target.value }))
      }
    >
      <option value="" disabled>
        请选择 remote
      </option>
      {remotes.map((r) => (
        <option key={r.name}>{r.name}</option>
      ))}
    </select>
  );
  const action =
    behind && !ahead ? "pull" : ahead && !behind ? "push" : "fetch";
  const menuItems: Record<string, MenuNode[]> = {
    file: [
      {
        label: "添加本地仓库…",
        nativeAction: "file.import",
        action: () => show("import"),
      },
      {
        label: "管理本地目录…",
        nativeAction: "file.manage-local",
        action: () => show("local-management"),
      },
      {
        label: "克隆仓库…",
        nativeAction: "file.clone",
        action: () => {
          setCloneRequest(undefined);
          show("clone-url");
        },
      },
      {
        label: "设置…",
        nativeAction: "app.settings",
        action: () => show("settings"),
      },
    ],
    edit: [
      {
        label: "在编辑器中打开",
        nativeAction: "edit.open-editor",
        disabled: !checkout,
        action: () => {
          if (checkout)
            void execute(() => api("OpenCheckout", checkout.id, "editor"));
        },
      },
      {
        label: "复制本地路径",
        nativeAction: "edit.copy-path",
        disabled: !checkout,
        action: () => {
          if (checkout)
            void execute(() => navigator.clipboard.writeText(checkout.path));
        },
      },
    ],
    view: [
      {
        label: "变更",
        nativeAction: "view.changes",
        action: () => {
          setTab("changes");
          setPopup("");
        },
      },
      {
        label: "历史",
        nativeAction: "view.history",
        action: () => {
          setTab("history");
          setPopup("");
        },
      },
      {
        label: "刷新仓库状态",
        nativeAction: "view.refresh",
        disabled: !checkout,
        action: () => {
          if (!checkout) return;
          void status.refetch();
          setPopup("");
        },
      },
      {
        label: "任务中心",
        nativeAction: "view.tasks",
        action: () => {
          ui.set({ tasksOpen: true });
          setPopup("");
        },
      },
      {
        label: "主题",
        children: [
          {
            label: "跟随系统",
            nativeAction: "view.theme.system",
            checked: theme === "system",
            action: () => setTheme("system"),
          },
          {
            label: "日间",
            nativeAction: "view.theme.light",
            checked: theme === "light",
            action: () => setTheme("light"),
          },
          {
            label: "暗黑",
            nativeAction: "view.theme.dark",
            checked: theme === "dark",
            action: () => setTheme("dark"),
          },
        ],
      },
    ],
    repository: [
      {
        label: "使用 VS Code 打开项目",
        nativeAction: "repository.open-vscode",
        disabled: !checkout,
        action: () => {
          if (checkout)
            void execute(() => api("OpenCheckout", checkout.id, "vscode"));
        },
      },
      {
        label: "在文件管理器中打开",
        nativeAction: "repository.open-folder",
        disabled: !checkout,
        action: () => {
          if (checkout)
            void execute(() => api("OpenCheckout", checkout.id, "folder"));
        },
      },
      {
        label: "在 GitHub 中查看",
        nativeAction: "repository.open-github",
        disabled: !(checkout && githubPath) && !selected?.repository,
        action: () => {
          if (checkout && githubPath)
            void execute(() =>
              api("OpenCheckoutGitHub", checkout.id, remote),
            );
          else if (selected?.repository)
            void execute(() => api("OpenRepository", selected.id));
        },
      },
      {
        label: "分享到 GitHub…",
        nativeAction: "repository.share",
        hidden: remotes.some((r) => /github\.com/i.test(r.url)),
        disabled:
          !checkout || !!checkout.plainDirectory || !st.accounts.length,
        action: () => {
          if (checkout && !checkout.plainDirectory && st.accounts.length)
            show("share");
        },
      },
      {
        label: "仓库设置…",
        nativeAction: "repository.settings",
        disabled: !checkout,
        action: () => {
          if (checkout) show("repository");
        },
      },
      {
        label: selected?.favorite ? "取消收藏" : "收藏仓库",
        nativeAction: "repository.favorite",
        disabled: !selected,
        action: () => {
          if (selected)
            void execute(() => api("ToggleFavorite", selected.id));
        },
      },
    ],
    update: [
      {
        label: "检查更新…",
        nativeAction: "update.check",
        action: () => void execute(() => api("CheckForUpdates")),
      },
    ],
    help: [
      {
        label: "账号与身份…",
        nativeAction: "help.accounts",
        action: () => show("accounts"),
      },
      {
        label: "关于 Repo Berth",
        nativeAction: "help.about",
        action: () => show("about"),
      },
    ],
  };
  const commands: Record<string, () => void> = {
    "branch.switch": () => setPopup("branch"),
  };
  for (const items of Object.values(menuItems))
    for (const item of items) {
      if (item.nativeAction && item.action)
        commands[item.nativeAction] = item.action;
      for (const child of item.children ?? [])
        if (child.nativeAction) commands[child.nativeAction] = child.action;
    }
  nativeCommands.current = commands;
  const filtered = filterRows(rows, ui.scope, repositorySearch, "", "all", st);
  const popupButton = (
    name: Popup,
    label: ReactNode,
    extra = "",
    disabled = false,
  ) => (
    <button
      disabled={disabled}
      className={extra}
      aria-expanded={popup === name}
      onClick={() => setPopup((p) => (p === name ? "" : name))}
    >
      {label}
    </button>
  );
  const branchList = branches.data || [];
  const localBranches = branchList.filter((branch) => !branch.remote);
  const remoteBranches = branchList.filter((branch) => branch.remote);
  const currentBranch = branchList.find((branch) => branch.current);
  const switchBranch = (name: string) => {
    void execute(async () => {
      await api("SwitchBranch", checkout!.id, name, false);
      setPopup("");
    });
  };
  const branchPopup = (
    <div className="desktop-popover branch-popover">
      <header>
        切换分支{" "}
        <button aria-label="关闭分支菜单" onClick={() => setPopup("")}>
          <X size={15} />
        </button>
      </header>
      <input
        autoFocus
        aria-label="筛选分支"
        placeholder="筛选分支…"
        value={branchSearch}
        onChange={(e) => setBranchSearch(e.target.value)}
      />
      {branches.isPending ? (
        <Loading />
      ) : branches.isError ? (
        <ErrorNotice message={errorMessage(branches.error)} />
      ) : (
        <div className="branch-choices">
          <div className="branch-heading">HEAD（当前分支）</div>
          <div className="branch-current">
            <GitBranch size={14} />
            <strong>
              {currentBranch?.name || status.data?.branch || "HEAD"}
            </strong>
            <Check size={14} />
          </div>
          <div className="branch-heading">本地</div>
          <BranchTreeView
            branches={localBranches}
            prefix="local"
            search={branchSearch}
            collapsed={collapsedBranchFolders}
            setCollapsed={setCollapsedBranchFolders}
            onSwitch={switchBranch}
            busy={busy}
          />
          {remoteBranches.length > 0 && (
            <>
              <div className="branch-heading">远程</div>
              <BranchTreeView
                branches={remoteBranches}
                prefix="remote"
                search={branchSearch}
                collapsed={collapsedBranchFolders}
                setCollapsed={setCollapsedBranchFolders}
                onSwitch={switchBranch}
                busy={busy}
              />
            </>
          )}
          {!branchList.some((branch) =>
            branch.name.toLowerCase().includes(branchSearch.toLowerCase()),
          ) && <p className="desktop-list-empty">没有匹配的分支</p>}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void execute(async () => {
            await api("SwitchBranch", checkout!.id, newBranch.trim(), true);
            setNewBranch("");
            setPopup("");
          });
        }}
      >
        <input
          aria-label="新分支名称"
          placeholder="新分支名称"
          value={newBranch}
          onChange={(e) => setNewBranch(e.target.value)}
        />
        <button disabled={busy || !newBranch.trim() || !checkout}>
          <Plus size={14} />
          新建分支
        </button>
      </form>
    </div>
  );
  return (
    <div className={`desktop-shell${customTitlebar ? " custom-titlebar" : ""}${nativeMenubar ? " native-menubar" : ""}`}>
      <nav className="desktop-menubar" aria-label="应用菜单">
        <img src="/app-icon.png" alt="" width="17" height="17" />
        <span className="desktop-app-name">Repo Berth</span>
        {[
          ["file", "文件"],
          ["edit", "编辑"],
          ["view", "视图"],
          ["repository", "仓库"],
          ["branch", "分支"],
          ["update", "更新"],
          ["help", "帮助"],
        ].map(([id, label]) => (
          <div data-desktop-popup key={id} onMouseEnter={() => {
            if (["file", "edit", "view", "repository", "branch", "update", "help"].includes(popup)) setPopup(id as Popup);
          }}>
            {popupButton(id as Popup, label)}
            {popup === id &&
              (id === "branch" ? (
                branchPopup
              ) : (
                <div className="desktop-popover menu-popover">
                  {menuItems[id]
                    ?.filter((item) => !item.hidden)
                    .map((item) =>
                    item.children ? (
                      <div className="menu-submenu" key={item.label}>
                        <button
                          className="menu-submenu-trigger"
                          disabled={item.disabled}
                        >
                          {item.label}
                          <ChevronRight size={14} />
                        </button>
                        <div className="menu-submenu-panel">
                          {item.children.map((child) => (
                            <button
                              key={child.label}
                              className={child.checked ? "checked" : ""}
                              onClick={() => {
                                setPopup("");
                                child.action();
                              }}
                            >
                              {child.label}
                              {child.checked && <Check size={14} />}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <button
                        key={item.label}
                        disabled={item.disabled}
                        onClick={() => {
                          setPopup("");
                          item.action?.();
                        }}
                      >
                        {item.label}
                      </button>
                    ),
                  )}
                </div>
              ))}
          </div>
        ))}
        {customTitlebar && (
          <>
            <span className="desktop-title-drag" aria-hidden="true" />
            <div className="desktop-window-controls">
              <button type="button" aria-label="最小化" title="最小化" onClick={() => windowCommand("Minimise")}><Minus size={16} /></button>
              <button type="button" aria-label="最大化或还原" title="最大化或还原" onClick={() => windowCommand("ToggleMaximise")}><Square size={13} /></button>
              <button type="button" aria-label="关闭窗口" title="关闭" onClick={() => windowCommand("Close")}><X size={17} /></button>
            </div>
          </>
        )}
      </nav>
      <header className="desktop-toolbar">
        <div className="toolbar-unit repository-unit" data-desktop-popup>
          {popupButton(
            "repositories",
            <>
              {selected ? (
                <RepositoryMark name={selected.name} size={28} />
              ) : (
                <FolderGit2 size={20} />
              )}
              <span>
                <small>当前仓库</small>
                <h1>{selected?.name || "选择仓库"}</h1>
              </span>
              <ChevronDown size={14} />
            </>,
          )}
        </div>
        <div className="toolbar-unit branch-unit" data-desktop-popup>
          {popupButton(
            "branches",
            <>
              <GitBranch size={20} />
              <span>
                <small>当前分支</small>
                <strong>
                  {status.data?.detached
                    ? "分离 HEAD"
                    : checkout?.plainDirectory
                      ? "非 Git 仓库"
                      : status.data?.branch || (checkout ? "读取中…" : "—")}
                </strong>
              </span>
              <ChevronDown size={14} />
            </>,
            "",
            !checkout || !!checkout.plainDirectory,
          )}
          {popup === "branches" && branchPopup}
        </div>
        <div className="toolbar-unit network-unit" data-desktop-popup>
          <button disabled={networkDisabled} onClick={() => network(action)}>
            {action === "pull" ? (
              <ArrowDown size={20} />
            ) : action === "push" ? (
              <ArrowUp size={20} />
            ) : (
              <RefreshCw size={20} className={busy ? "spinning" : ""} />
            )}
            <span>
              <span className="network-title">
                <strong>
                  {action === "fetch"
                    ? "Fetch"
                    : action === "pull"
                      ? "Pull"
                      : "Push"}{" "}
                  {remote || "remote"}
                </strong>
                {(ahead > 0 || behind > 0) && (
                  <span className="sync-pill">
                    {ahead > 0 && <span className="sync-ahead">↑{ahead}</span>}
                    {behind > 0 && (
                      <span className="sync-behind">↓{behind}</span>
                    )}
                  </span>
                )}
                {remoteHasUpdates && (
                  <span
                    className="remote-update-dot"
                    title="远端有新提交，可 Fetch 查看"
                  />
                )}
              </span>
              {busy ? (
                <small>执行中…</small>
              ) : status.isError ? (
                <small>状态读取失败</small>
              ) : remoteHasUpdates ? (
                <small>
                  远端有新提交 · {formatSyncTime(statusUpdated || lastFetch)}
                </small>
              ) : statusUpdated || lastFetch ? (
                <small>
                  {statusUpdated ? "状态更新" : "上次获取"}{" "}
                  {formatSyncTime(statusUpdated || lastFetch)}
                </small>
              ) : (
                <small>等待状态同步</small>
              )}
            </span>
          </button>
          {popupButton("network", <ChevronDown size={14} />, "network-more")}
          {popup === "network" && (
            <div className="desktop-popover menu-popover">
              {["fetch", "pull", "push"].map((op) => (
                <button
                  key={op}
                  disabled={networkDisabled}
                  onClick={() => {
                    network(op);
                    setPopup("");
                  }}
                >
                  {op === "fetch"
                    ? "Fetch"
                    : op === "pull"
                      ? "Pull"
                      : "Push"}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="toolbar-spacer" />
        <div className="toolbar-unit account-unit" data-desktop-popup>
          {popupButton(
            "accounts",
            <>
              {account ? (
                <AccountAvatar account={account} size={28} />
              ) : (
                <UsersRound size={20} />
              )}
              <span>
                <small>访问账号 · {accessSource}</small>
                <strong>{account?.login || "选择或添加账号"}</strong>
              </span>
              <ChevronDown size={14} />
            </>,
          )}
          {popup === "accounts" && (
            <div className="desktop-popover account-popover">
              <header>
                GitHub 账号 <span>{st.accounts.length}</span>
              </header>
              {st.accounts.map((a) => (
                <button
                  className="account-choice"
                  disabled={busy}
                  key={a.id}
                  onClick={() => chooseAccount(a.id)}
                >
                  <AccountAvatar account={a} size={29} />
                  <span>
                    <strong>{a.login}</strong>
                    <small>
                      {a.status === "auth_required" ? "需要重新授权" : "GitHub"}
                      {a.id === st.settings.defaultAccountId ? " · 默认" : ""}
                    </small>
                  </span>
                  {a.id === account?.id && <Check size={16} />}
                </button>
              ))}
              <button onClick={() => show("accounts")}>
                <Plus size={15} />
                添加 / 管理账号
              </button>
              <p>
                用于当前 Git
                网络操作，选择后记作默认账号。仓库已有绑定时优先使用绑定；不切换仓库、不更改提交信息。
              </p>
            </div>
          )}
        </div>
      </header>
      {popup === "repositories" && (
        <div className="desktop-popover repository-popover" data-desktop-popup>
          <header>
            仓库{" "}
            <button aria-label="关闭仓库菜单" onClick={() => setPopup("")}>
              <X size={15} />
            </button>
          </header>
          <div className="repository-picker-tools">
            <label>
              <Search size={15} />
              <input
                aria-label="搜索仓库"
                autoFocus
                value={repositorySearch}
                onChange={(e) => setRepositorySearch(e.target.value)}
                placeholder="搜索仓库或本地路径…"
              />
            </label>
            <ScopePicker
              state={st}
              value={ui.scope}
              onChange={(scope) => ui.set({ scope })}
            />
          </div>
          <div className="repository-picker-list">
            {filtered.map((row) => (
              <div className="repository-picker-group" key={row.id}>
                {row.checkouts.length ? (
                  row.checkouts.map((c) => (
                    <button
                      key={c.id}
                      className={`repository-row ${checkout?.id === c.id ? "selected" : ""}`}
                      onClick={() => {
                        const requested = ui.scope.startsWith("account:")
                          ? ui.scope.slice(8)
                          : "";
                        const b = st.bindings.find(
                          (b) =>
                            b.checkoutId === c.id && b.accountId === requested,
                        );
                        choose(row, c.id, b?.remote);
                      }}
                    >
                      <RepositoryMark name={row.name} />
                      <span>
                        <strong>
                          {row.repository
                            ? `${row.owner}/${row.name}`
                            : row.name}
                          {c.plainDirectory ? " · 普通目录" : ""}
                        </strong>
                        <small>{c.path}</small>
                      </span>
                      {row.favorite && <Star size={13} />}
                    </button>
                  ))
                ) : (
                  <button className="repository-row" onClick={() => clone(row)}>
                    <RepositoryMark name={row.name} />
                    <span>
                      <strong>
                        {row.owner}/{row.name}
                      </strong>
                      <small>云端仓库 · 点击克隆</small>
                    </span>
                    <Plus size={15} />
                  </button>
                )}
              </div>
            ))}
            {!filtered.length && (
              <p className="desktop-list-empty">
                {rows.length
                  ? "没有匹配的仓库"
                  : "还没有仓库，添加本地目录或克隆 GitHub 仓库。"}
              </p>
            )}
          </div>
          <footer>
            <button onClick={() => show("import")}>
              <FolderOpen size={14} />
              添加本地仓库
            </button>
            <button
              disabled={!st.accounts.length}
              onClick={() =>
                void execute(async () => {
                  for (const a of st.accounts)
                    await api("SyncRepositories", a.id);
                })
              }
            >
              <RefreshCw size={14} />
              同步云端列表
            </button>
          </footer>
        </div>
      )}
      {error && (
        <div className="desktop-error" role="alert">
          <span>{error}</span>
          <button
            onClick={() => {
              ui.set({ tasksOpen: true });
              setError("");
            }}
          >
            查看任务
          </button>
          <button aria-label="关闭错误提示" onClick={() => setError("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {isError ? (
        <div className="desktop-fatal">
          <ErrorNotice message="无法读取本地数据" />
          <button
            onClick={() =>
              void client.invalidateQueries({ queryKey: ["state"] })
            }
          >
            重新读取
          </button>
        </div>
      ) : loading ? (
        <div className="desktop-fatal">
          <Loading />
        </div>
      ) : checkout?.plainDirectory ? (
        <main className="desktop-plain-directory">
          <FolderOpen size={36} />
          <h1>
            {checkout.name} <small>普通目录 · 非 Git 仓库</small>
          </h1>
          <p className="path-text">{checkout.path}</p>
          <div className="form-actions">
            <button
              onClick={() =>
                void execute(() => api("OpenCheckout", checkout.id, "folder"))
              }
            >
              打开文件夹
            </button>
            <button
              onClick={() =>
                void execute(() => api("OpenCheckout", checkout.id, "editor"))
              }
            >
              打开编辑器
            </button>
            <button onClick={() => show("repository")}>目录设置</button>
            <button
              onClick={() =>
                void execute(() => api("ImportCheckout", checkout.path))
              }
            >
              重新检测 Git 仓库
            </button>
          </div>
        </main>
      ) : checkout ? (
        <Worktree
          key={checkout.id}
          checkout={checkout}
          state={st}
          row={selected!}
          status={status.data}
          statusError={status.isError ? errorMessage(status.error) : ""}
          verifying={verifying}
          remote={remote}
          accountID={account?.id || ""}
          busy={busy}
          tab={tab}
          setTab={setTab}
          execute={execute}
          configure={() => show("repository")}
          accountSettings={() => show("accounts")}
          openRepository={() =>
            void execute(() => api("OpenRepository", selected!.id))
          }
        />
      ) : (
        <div className="desktop-workspace no-repository">
          <aside className="desktop-sidebar">
            <div className="desktop-tabs">
              <button className="active">变更</button>
              <button disabled>历史</button>
            </div>
            <p className="desktop-list-empty">请选择本地仓库</p>
            <div className="empty-commit">
              <input disabled placeholder="提交摘要（必填）" />
              <textarea disabled placeholder="描述" />
              <button disabled>提交</button>
            </div>
          </aside>
          <main className="desktop-detail">
            <div className="desktop-start">
              <FolderGit2 size={42} strokeWidth={1.2} />
              <h2>开始管理你的仓库</h2>
              <div className="desktop-next-actions">
                <ActionRow
                  title="添加已有的本地仓库"
                  action="选择本地目录"
                  onClick={() => show("import")}
                />
                <ActionRow
                  title="从 GitHub 克隆仓库"
                  action="填写仓库地址"
                  onClick={() => { setCloneRequest(undefined); show("clone-url"); }}
                />
                {!st.accounts.length && <ActionRow
                  title="连接 GitHub 账号"
                  action="添加 GitHub 账号"
                  onClick={() => show("accounts")}
                />}
              </div>
              {!isDesktop && (
                <p className="desktop-preview">
                  浏览器预览 · Git 操作请使用桌面应用
                </p>
              )}
            </div>
          </main>
        </div>
      )}
      <footer className="desktop-statusbar">
        <span className="desktop-env-status">
          {version}
          {!isDesktop
            ? " · 浏览器预览"
            : environment.isError
              ? " · Git 不可用"
              : environment.data
                ? " · Git 已就绪"
                : " · 正在检测 Git"}
        </span>
        <div id="desktop-filebar-slot" className="desktop-filebar-slot" />
        <button onClick={() => show("settings")}>
          <Settings2 size={13} />
          设置
        </button>
        <button onClick={() => ui.set({ tasksOpen: !ui.tasksOpen })}>
          <Activity size={13} />
          任务中心
          {activeTasks.length ? ` · ${activeTasks.length} 项进行中` : ""}
        </button>
      </footer>
      {ui.tasksOpen && (
        <aside className="task-drawer desktop-tasks" aria-label="任务中心">
          <header>
            <h2>任务进度</h2>
            <button
              aria-label="关闭任务中心"
              onClick={() => ui.set({ tasksOpen: false })}
            >
              <X size={18} />
            </button>
          </header>
          {st.tasks.some((t) => t.state === "succeeded") && <button className="text-button" onClick={() => setShowCompletedTasks((v) => !v)}>{showCompletedTasks ? "隐藏已完成" : "查看已完成"}</button>}
          <div className="task-list">
            {st.tasks.some((t) => showCompletedTasks || t.state !== "succeeded") ? (
              st.tasks.filter((t) => showCompletedTasks || t.state !== "succeeded").map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  st={st}
                  execute={execute}
                  onClone={() => {
                    if (t.cloneRequest?.url) { setCloneRequest(t.cloneRequest); show("clone-url"); }
                    else {
                      const row = rows.find((r) => r.id === t.target);
                      if (row) clone(row, t.cloneRequest);
                    }
                  }}
                  onOpenCheckout={() => openTarget(t.target)}
                />
              ))
            ) : (
              <p className="desktop-list-empty">
                当前没有进行中或失败的任务。
              </p>
            )}
          </div>
        </aside>
      )}
      {panel === "accounts" && (
        <Modal title="账号与身份" onClose={closePanel}>
          <AccountsView st={st} execute={execute} />
        </Modal>
      )}
      {panel === "settings" && (
        <Modal title="设置" onClose={closePanel}>
          <SettingsView st={st} execute={execute} />
        </Modal>
      )}
      {panel === "about" && (
        <Modal title="关于 Repo Berth" onClose={closePanel}>
          <div className="desktop-about">
            <img src="/app-icon.png" width="64" height="64" alt="" />
            <h2>Repo Berth {version}</h2>
            <p>熟悉的 Git 工作流，独立的多账号身份。</p>
            <p>账号凭据保存在本设备的系统凭据库。</p>
          </div>
        </Modal>
      )}
      {panel === "import" && (
        <ImportModal
          execute={execute}
          onClose={closePanel}
          onImported={(rowID, id) => {
            ui.set({ selected: rowID, view: "repositories" });
            setCopyID(id || rowID);
            setTab("changes");
          }}
        />
      )}
      {panel === "clone" && st.repositories.find((r) => r.id === cloneID) && (
        <Modal title="克隆仓库" onClose={closePanel}>
          <CloneForm
            key={cloneID + (cloneRequest?.destination || "")}
            repository={st.repositories.find((r) => r.id === cloneID)!}
            st={st}
            execute={execute}
            initial={cloneRequest}
            preferredAccountID={
              ui.scope.startsWith("account:") ? ui.scope.slice(8) : account?.id
            }
            onDone={() => {
              closePanel();
              ui.set({ tasksOpen: true });
            }}
          />
        </Modal>
      )}
      {panel === "clone-url" && (
        <Modal title="克隆 GitHub 仓库" onClose={closePanel}>
          <CloneURLForm
            key={cloneRequest?.destination || "new"}
            st={st} execute={execute} initial={cloneRequest}
            preferredAccountID={ui.scope.startsWith("account:") ? ui.scope.slice(8) : account?.id}
            onDone={() => { closePanel(); ui.set({ tasksOpen: true }); }}
          />
        </Modal>
      )}
      {panel === "binding" && checkout && remote && (
        <BindingModal
          key={checkout.id + remote + account?.id}
          checkout={checkout}
          remote={remote}
          remoteURL={remotes.find((r) => r.name === remote)?.url || ""}
          st={st}
          execute={execute}
          initialAccountID={account?.id}
          onClose={closePanel}
        />
      )}
      {panel === "repository" && checkout && (
        <Modal title="仓库设置" onClose={closePanel}>
          <div className="desktop-repo-options">
            <p className="path-text">{checkout.path}</p>
            <Field label="本地副本">
              <select
                value={checkout.id}
                onChange={(e) => setCopyID(e.target.value)}
              >
                {selected?.checkouts.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.path}
                  </option>
                ))}
              </select>
            </Field>
            {!checkout.plainDirectory && (
              <>
                <h3>提交信息</h3>
                <CheckoutIdentity
                  key={checkout.id}
                  checkout={checkout}
                  execute={execute}
                />
              </>
            )}
            {!checkout.plainDirectory && (
              <>
                <Field label="remote">{remoteSelect}</Field>
                <p>
                  远程仓库：
                  {githubRepositoryPath(
                    remotes.find((r) => r.name === remote)?.url || "",
                  ) || "无法识别"}
                  <br />
                  访问账号：{account?.login || "未绑定"}（{accessSource}）
                  <br />
                  提交身份：
                  {(() => {
                    const p = effectiveCommitIdentity(st, checkout, profile, !!account);
                    return p ? `${p.name} <${p.email}>` : "未确认";
                  })()}
                </p>
                <button
                  disabled={!remote || verifying}
                  onClick={() => show("binding")}
                >
                  配置访问账号
                </button>
              </>
            )}
            <div className="desktop-options-actions">
              <button
                onClick={() =>
                  void execute(() => api("ToggleFavorite", selected!.id))
                }
              >
                <Star size={14} />
                {selected?.favorite ? "取消收藏" : "收藏仓库"}
              </button>
              {!checkout.plainDirectory &&
                !remotes.some((r) => /github\.com/i.test(r.url)) && (
                  <button onClick={() => show("share")}>
                    <Github size={14} />
                    分享到 GitHub
                  </button>
                )}
              {selected?.repository && (
                <button onClick={() => clone(selected)}>
                  <Plus size={14} />
                  新建副本
                </button>
              )}
            </div>
            <hr />
            <button disabled={busy} onClick={() => show("forget")}>
              将此副本移出管理…
            </button>
          </div>
        </Modal>
      )}
      {panel === "local-management" && (
        <LocalManagement st={st} execute={execute} onClose={closePanel} />
      )}
      {panel === "share" && checkout && (
        <Modal title="分享到 GitHub" onClose={closePanel}>
          <ShareForm
            key={checkout.id}
            checkout={checkout}
            st={st}
            execute={execute}
            onDone={() => {
              closePanel();
              ui.set({ tasksOpen: true });
            }}
          />
        </Modal>
      )}
      {panel === "forget" && checkout && (
        <Modal title="将此本地副本移出管理？" onClose={closePanel}>
          <p>只移除应用记录和绑定，不删除文件或 Git 历史。</p>
          <p className="path-text">{checkout.path}</p>
          <div className="form-actions">
            <button onClick={closePanel}>取消</button>
            <button
              disabled={busy}
              onClick={() =>
                void execute(async () => {
                  await api("ForgetCheckout", checkout.id);
                  setCopyID("");
                  ui.set({ selected: "" });
                  closePanel();
                })
              }
            >
              移出管理
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ActionRow({
  title,
  action,
  onClick,
}: {
  title: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <button className="desktop-action-row" title={title} onClick={onClick}>{action}</button>
  );
}

function Worktree({
  checkout: c,
  state: st,
  row,
  status,
  statusError,
  verifying,
  remote,
  accountID,
  busy,
  tab,
  setTab,
  execute,
  configure,
  accountSettings,
  openRepository,
}: {
  checkout: Checkout;
  state: State;
  row: Row;
  status?: GitStatus;
  statusError: string;
  verifying: boolean;
  remote: string;
  accountID: string;
  busy: boolean;
  tab: "changes" | "history";
  setTab: (tab: "changes" | "history") => void;
  execute: Execute;
  configure: () => void;
  accountSettings: () => void;
  openRepository: () => void;
}) {
  const client = useQueryClient();
  const [filter, setFilter] = useState(""),
    [fileView, setFileView] = useState<"changes" | "all">("changes"),
    [selected, setSelected] = useState<{ path: string; staged: boolean }>(),
    [commitHash, setCommitHash] = useState(""),
    [historyFile, setHistoryFile] = useState(""),
    [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set()),
    [sending, setSending] = useState(false),
    [stageOverrides, setStageOverrides] = useState<Record<string, boolean>>({}),
    [stagingPaths, setStagingPaths] = useState<Set<string>>(new Set()),
    [stageError, setStageError] = useState(""),
    [changesCollapsed, setChangesCollapsed] = useState<Set<string>>(new Set()),
    [menu, setMenu] = useState<{
      x: number;
      y: number;
      node: FileTreeNode;
    }>(),
    [editing, setEditing] = useState(""),
    [editorText, setEditorText] = useState(""),
    [editorOriginal, setEditorOriginal] = useState(""),
    [editorLoading, setEditorLoading] = useState(false),
    [editorSaving, setEditorSaving] = useState(false),
    [editorError, setEditorError] = useState(""),
    [cursorLine, setCursorLine] = useState(1),
    [newFileOpen, setNewFileOpen] = useState(false),
    [newFileName, setNewFileName] = useState(""),
    [newFileError, setNewFileError] = useState(""),
    [newItemKind, setNewItemKind] = useState<"file" | "dir">("file"),
    [treeSelected, setTreeSelected] = useState(""),
    [clipboard, setClipboard] = useState<{ path: string; cut: boolean }>(),
    [previewPath, setPreviewPath] = useState(""),
    [renameTarget, setRenameTarget] = useState<FileTreeNode>(),
    [renameName, setRenameName] = useState(""),
    [renameError, setRenameError] = useState(""),
    [fileBarSlot, setFileBarSlot] = useState<HTMLElement | null>(null),
    [formatBusy, setFormatBusy] = useState(false),
    [languageOverrides, setLanguageOverrides] = useState<
      Record<string, LanguageId>
    >({}),
    [lineEndingRisks, setLineEndingRisks] = useState<LineEndingRisk[]>(),
    [lineEndingBusy, setLineEndingBusy] = useState(false),
    [lineEndingError, setLineEndingError] = useState("");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const editorHighlightRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    setFileBarSlot(document.getElementById("desktop-filebar-slot"));
  }, []);
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element).closest(".desktop-context-menu"))
        setMenu(undefined);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(undefined);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
    };
  }, [menu]);
  const draft = useUI((s) => s.commitDrafts[c.id] || ""),
    submission = useUI((s) => s.commitSubmissions[c.id]);
  const split = draft.indexOf("\n");
  const summary = split < 0 ? draft : draft.slice(0, split);
  const description =
    split < 0 ? "" : draft.slice(split + 1).replace(/^\n/, "");
  const writeDraft = (title: string, body: string) =>
    useUI.getState().setCommitDraft(c.id, title + (body ? "\n\n" + body : ""));
  const files = status?.files || [];
  const allFiles = useQuery({
    queryKey: ["git", "files", c.id],
    queryFn: () => api("GitFiles", c.id),
    enabled: tab === "changes" && fileView === "all",
  });
  const staged = files.filter(hasStaged);
  const isChanged = (f: FileStatus) => hasStaged(f) || hasUnstaged(f);
  const statusByPath = useMemo(
    () => new Map(files.map((file) => [file.path, file])),
    [files],
  );
  const sourceFiles = useMemo(() => {
    if (fileView === "changes") return files;
    return (allFiles.data || []).map((entry) => {
      const changed = statusByPath.get(entry.path);
      return (
        changed || {
          path: entry.path,
          originalPath: "",
          index: " ",
          worktree: " ",
          tracked: entry.tracked,
        }
      );
    });
  }, [allFiles.data, fileView, files, statusByPath]);
  const fullyStaged = (f: FileStatus) => stageOverrides[f.path] ?? (hasStaged(f) && !hasUnstaged(f));
  const stageFiles = async (targets: FileStatus[], next: boolean) => {
    if (!targets.length) return;
    setStageError("");
    setStageOverrides((old) => Object.fromEntries([...Object.entries(old), ...targets.map((f) => [f.path, next])]));
    setStagingPaths((old) => new Set([...old, ...targets.map((f) => f.path)]));
    try {
      if (targets.length === 1) await api("StageFile", c.id, targets[0].path, next);
      else await api("StageFiles", c.id, targets.map((f) => f.path), next);
      await client.invalidateQueries({ queryKey: ["git", "status", c.id] });
      await client.invalidateQueries({ queryKey: ["git", "diff", c.id] });
    } catch (e) {
      setStageError(errorMessage(e));
      await client.invalidateQueries({ queryKey: ["git", "status", c.id] });
    } finally {
      setStageOverrides((old) => { const nextValues = { ...old }; for (const f of targets) delete nextValues[f.path]; return nextValues; });
      setStagingPaths((old) => { const nextValues = new Set(old); for (const f of targets) nextValues.delete(f.path); return nextValues; });
    }
  };
  const filtered = sourceFiles.filter((f) =>
    f.path.toLowerCase().includes(filter.toLowerCase()),
  );
  const tree = useMemo(
    () =>
      buildFileTree(
        filtered,
        fileView === "all" ? { name: c.name, path: "" } : undefined,
      ),
    [filtered, fileView, c.name],
  );
  const selectedNode = useMemo(
    () => findTreeNode(tree, treeSelected),
    [tree, treeSelected],
  );
  const createBase = selectedNode
    ? selectedNode.isDir
      ? selectedNode.path
      : parentPath(selectedNode.path)
    : "";
  const confirmDiscard = () =>
    !editing ||
    editorText === editorOriginal ||
    window.confirm("未保存的修改将丢失，继续？");
  const selectFile = (f: FileStatus) => {
    if (!confirmDiscard()) return;
    setEditing("");
    setPreviewPath("");
    setTreeSelected(f.path);
    setSelected({
      path: f.path,
      staged: hasStaged(f) && !hasUnstaged(f),
    });
  };
  const closeEditor = () => {
    if (!confirmDiscard()) return;
    setEditing("");
    setEditorError("");
  };
  const openPreview = (path: string) => {
    if (!confirmDiscard()) return;
    setEditing("");
    setSelected(undefined);
    setPreviewPath(path);
    setTreeSelected(path);
  };
  const activateFile = (item: FileStatus) => {
    setTreeSelected(item.path);
    if (isChanged(item)) {
      selectFile(item);
      return;
    }
    openPreview(item.path);
  };
  const openEditor = async (path: string) => {
    setMenu(undefined);
    setEditorError("");
    if (editing === path) return;
    if (!confirmDiscard()) return;
    setEditorLoading(true);
    try {
      const content = await api("GitFileContent", c.id, path);
      setEditorText(content);
      setEditorOriginal(content);
      setCursorLine(1);
      setEditing(path);
      setPreviewPath("");
      setTreeSelected(path);
      const target = files.find((item) => item.path === path);
      if (target)
        setSelected({
          path,
          staged: hasStaged(target) && !hasUnstaged(target),
        });
    } catch (e) {
      setEditorText("");
      setEditorOriginal("");
      setEditorError(errorMessage(e));
      if (errorMessage(e).includes("二进制")) {
        setEditing("");
        openPreview(path);
      } else {
        setEditing(path);
      }
    } finally {
      setEditorLoading(false);
    }
  };
  const saveEditor = async () => {
    if (!editing) return;
    setEditorSaving(true);
    setEditorError("");
    try {
      await api("SaveWorkingFile", c.id, editing, editorText);
      setEditorOriginal(editorText);
      await client.invalidateQueries({ queryKey: ["git", "status", c.id] });
      await client.invalidateQueries({ queryKey: ["git", "diff", c.id] });
    } catch (e) {
      setEditorError(errorMessage(e));
    } finally {
      setEditorSaving(false);
    }
  };
  const refreshWorkingTree = async () => {
    await client.invalidateQueries({ queryKey: ["git", "status", c.id] });
    await client.invalidateQueries({ queryKey: ["git", "files", c.id] });
    await client.invalidateQueries({ queryKey: ["git", "diff", c.id] });
    await client.invalidateQueries({ queryKey: ["git", "file-info", c.id] });
  };
  const startCreate = (base: string, kind: "file" | "dir") => {
    setMenu(undefined);
    setNewItemKind(kind);
    setNewFileName(base ? base.replace(/\/+$/, "") + "/" : "");
    setNewFileError("");
    setNewFileOpen(true);
  };
  const createFile = async () => {
    const name = newFileName.trim().replace(/^\/+/, "");
    if (!name) return;
    setNewFileError("");
    try {
      if (newItemKind === "dir")
        await api("CreateWorkingDirectory", c.id, name);
      else await api("CreateWorkingFile", c.id, name);
      setNewFileOpen(false);
      setNewFileName("");
      await refreshWorkingTree();
      setTreeSelected(name);
      if (newItemKind === "file") await openEditor(name);
      else {
        setChangesCollapsed((old) => {
          const next = new Set(old);
          next.delete("");
          const parts = name.split("/");
          for (let index = 1; index < parts.length; index++)
            next.delete(parts.slice(0, index).join("/"));
          return next;
        });
      }
    } catch (e) {
      setNewFileError(errorMessage(e));
    }
  };
  const renameEntry = async () => {
    if (!renameTarget) return;
    setRenameError("");
    try {
      await api("RenameWorkingPath", c.id, renameTarget.path, renameName);
      const parent = renameTarget.path.includes("/")
        ? renameTarget.path.slice(0, renameTarget.path.lastIndexOf("/"))
        : "";
      const nextPath = parent ? `${parent}/${renameName}` : renameName;
      if (treeSelected === renameTarget.path) setTreeSelected(nextPath);
      if (previewPath === renameTarget.path) setPreviewPath(nextPath);
      if (editing === renameTarget.path) setEditing(nextPath);
      setSelected((old) =>
        old?.path === renameTarget.path ? { ...old, path: nextPath } : old,
      );
      setRenameTarget(undefined);
      await refreshWorkingTree();
    } catch (e) {
      setRenameError(errorMessage(e));
    }
  };
  const removeEntry = (node: FileTreeNode) => {
    if (!window.confirm(`确定删除 ${node.path}？此操作不可撤销。`)) return;
    setMenu(undefined);
    const affected = (path: string) =>
      path === node.path || (node.isDir && path.startsWith(node.path + "/"));
    void execute(async () => {
      await api("DeleteWorkingPath", c.id, node.path);
      if (affected(treeSelected)) setTreeSelected("");
      if (affected(previewPath)) setPreviewPath("");
      if (affected(editing)) setEditing("");
      if (selected && affected(selected.path)) setSelected(undefined);
      await refreshWorkingTree();
    });
  };
  const copyEntry = (node: FileTreeNode, cut: boolean) => {
    setClipboard({ path: node.path, cut });
    setMenu(undefined);
  };
  const pasteInto = (node: FileTreeNode) => {
    if (!clipboard) return;
    const destination = node.isDir
      ? node.path
      : node.path.includes("/")
        ? node.path.slice(0, node.path.lastIndexOf("/"))
        : "";
    setMenu(undefined);
    void execute(async () => {
      await api("CopyWorkingPath", c.id, clipboard.path, destination, clipboard.cut);
      if (clipboard.cut) setClipboard(undefined);
      await refreshWorkingTree();
    });
  };
  const openMenu = (event: ReactMouseEvent, node: FileTreeNode) => {
    event.preventDefault();
    event.stopPropagation();
    setTreeSelected(node.path);
    setMenu({
      x: Math.min(event.clientX, Math.max(8, window.innerWidth - 220)),
      y: Math.min(event.clientY, Math.max(8, window.innerHeight - 260)),
      node,
    });
  };
  const stageNode = (node: FileTreeNode, next: boolean) => {
    setMenu(undefined);
    void stageFiles(
      (node.file ? [node.file] : flattenTree(node)).filter(isChanged),
      next,
    );
  };
  const nodeStaged = (node: FileTreeNode) => {
    const targets = (node.file ? [node.file] : flattenTree(node)).filter(
      isChanged,
    );
    return targets.length > 0 && targets.every(fullyStaged);
  };
  const ignoreNode = (node: FileTreeNode) => {
    setMenu(undefined);
    void execute(async () => {
      await api("AddToGitignore", c.id, node.path, node.isDir);
      await client.invalidateQueries({ queryKey: ["git", "status", c.id] });
      await client.invalidateQueries({ queryKey: ["git", "files", c.id] });
    });
  };
  const untrackNode = (node: FileTreeNode) => {
    setMenu(undefined);
    if (
      !window.confirm(
        `${node.isDir ? "递归" : ""}从 Git 索引移除 ${node.path}？磁盘文件会保留。`,
      )
    )
      return;
    void execute(async () => {
      await api("UntrackFile", c.id, node.path, node.isDir);
      await client.invalidateQueries({ queryKey: ["git", "status", c.id] });
      await client.invalidateQueries({ queryKey: ["git", "files", c.id] });
    });
  };
  const updateCursorLine = () => {
    const position = editorRef.current?.selectionStart ?? 0;
    setCursorLine(editorText.slice(0, position).split("\n").length);
  };
  const renderTree = (nodes: FileTreeNode[], depth: number): ReactNode[] =>
    nodes.flatMap((node) => {
      if (node.isDir) {
        const expanded = !!filter || !changesCollapsed.has(node.path);
        const stats = treeStats(node);
        return [
          <div
            className={`tree-folder ${treeSelected === node.path ? "selected" : ""}`}
            key={`folder:${node.path}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => {
              setTreeSelected(node.path);
              setChangesCollapsed((old) => {
                const next = new Set(old);
                if (next.has(node.path)) next.delete(node.path);
                else next.add(node.path);
                return next;
              });
            }}
            onContextMenu={(event) => openMenu(event, node)}
          >
            {expanded ? (
              <ChevronDown size={13} />
            ) : (
              <ChevronRight size={13} />
            )}
            {expanded ? <FolderOpen size={14} /> : <Folder size={14} />}
            <span className="tree-name" title={node.path}>
              {node.name}
            </span>
            {stats.additions > 0 && (
              <span className="tree-stat stat-add">+{stats.additions}</span>
            )}
            {stats.deletions > 0 && (
              <span className="tree-stat stat-del">−{stats.deletions}</span>
            )}
          </div>,
          ...(expanded ? renderTree(node.children, depth + 1) : []),
        ];
      }
      const item = node.file!;
      const stats = fileStats(item);
      const changed = isChanged(item);
      return [
        <div
          className={`desktop-file-row tree-file ${file?.path === item.path ? "selected" : ""} ${treeSelected === item.path ? "tree-selected" : ""}`}
          key={`file:${item.path}`}
          style={{ paddingLeft: 6 + depth * 14 }}
          onContextMenu={(event) => openMenu(event, node)}
        >
          {changed ? (
            <label
              className="file-stage-toggle"
              title={
                fullyStaged(item)
                  ? `取消暂存 ${item.path}`
                  : `暂存 ${item.path}`
              }
            >
              <input
                aria-label={`${fullyStaged(item) ? "取消暂存" : "暂存"} ${item.path}`}
                type="checkbox"
                checked={fullyStaged(item)}
                disabled={
                  busy ||
                  !!statusError ||
                  !status ||
                  stagingPaths.has(item.path)
                }
                onChange={() => stage(item)}
              />
            </label>
          ) : (
            <span className="file-stage-spacer" />
          )}
          <button
            title={item.path}
            className="file-name"
            onClick={() => {
              if (fileView === "all" && !changed)
                void activateFile(item);
              else selectFile(item);
            }}
          >
            <FileText size={13} />
            <span>
              {item.originalPath ? `${item.originalPath} → ` : ""}
              {node.name}
            </span>
          </button>
          <span className="file-line-stats">
            {stats.additions > 0 && (
              <span className="stat-add">+{stats.additions}</span>
            )}
            {stats.deletions > 0 && (
              <span className="stat-del">−{stats.deletions}</span>
            )}
          </span>
          {changed && (
            <code
              className={
                item.index === "?" || item.index === "A"
                  ? "added"
                  : item.index === "D" || item.worktree === "D"
                    ? "removed"
                    : ""
              }
            >
              {item.index === "?"
                ? "+"
                : item.worktree.trim() || item.index.trim()}
            </code>
          )}
        </div>,
      ];
    });
  const file = files.find((f) => f.path === selected?.path);
  const selectedSide = file
    ? selected?.staged
      ? hasStaged(file)
      : !hasUnstaged(file)
    : false;
  const activeFile = file
    ? { path: file.path, staged: selectedSide }
    : undefined;
  const infoPath = previewPath || editing || activeFile?.path || "";
  const fileInfo = useQuery({
    queryKey: ["git", "file-info", c.id, infoPath],
    queryFn: () => api("InspectWorkingFile", c.id, infoPath),
    enabled: tab === "changes" && !!infoPath,
  });
  const infoLanguage =
    languageOverrides[infoPath] || detectLanguage(infoPath);
  const preview = useQuery({
    queryKey: ["git", "file-preview", c.id, previewPath],
    queryFn: () => api("ReadWorkingFilePreview", c.id, previewPath),
    enabled:
      tab === "changes" &&
      !!previewPath &&
      ["image", "audio", "video"].includes(
        fileInfo.data?.previewKind || "",
      ) &&
      !fileInfo.data?.tooLarge,
  });
  const previewText = useQuery({
    queryKey: ["git", "file-text", c.id, previewPath],
    queryFn: () => api("GitFileContent", c.id, previewPath),
    enabled:
      tab === "changes" &&
      !!previewPath &&
      fileInfo.data?.previewKind === "text" &&
      !!fileInfo.data?.editable,
  });
  useEffect(() => {
    const info = fileInfo.data;
    if (!activeFile || editing || !info || info.path !== activeFile.path) return;
    if (info.previewKind !== "text") setPreviewPath(activeFile.path);
  }, [activeFile?.path, editing, fileInfo.data]);
  const diff = useQuery({
    queryKey: ["git", "diff", c.id, activeFile?.path, activeFile?.staged],
    queryFn: () => api("GitDiff", c.id, activeFile!.path, activeFile!.staged),
    enabled: tab === "changes" && !!activeFile,
  });
  const activeRawStats = file
    ? {
        additions:
          (selectedSide ? file.indexAdditions : file.worktreeAdditions) || 0,
        deletions:
          (selectedSide ? file.indexDeletions : file.worktreeDeletions) || 0,
      }
    : { additions: 0, deletions: 0 };
  const activeFilteredStats = diffStats(diff.data || "");
  const activeIgnored = Math.max(
    0,
    activeRawStats.additions +
      activeRawStats.deletions -
      activeFilteredStats.insertions -
      activeFilteredStats.deletions,
  );
  const history = useQuery({
    queryKey: ["git", "history", c.id],
    queryFn: () => api("GitHistory", c.id),
    enabled: tab === "history",
  });
  const commit = history.data?.find((item) => item.hash === commitHash);
  const commitDiff = useQuery({
    queryKey: ["git", "commit-diff", c.id, commit?.hash],
    queryFn: () => api("GitCommitDiff", c.id, commit!.hash),
    enabled: tab === "history" && !!commit,
  });
  const commitDiffFiltered = useQuery({
    queryKey: ["git", "commit-diff-filtered", c.id, commit?.hash],
    queryFn: () => api("GitCommitDiffFiltered", c.id, commit!.hash),
    enabled: tab === "history" && !!commit,
  });
  const historyFiles = useMemo(() => {
    const chunks = (commitDiff.data || "")
      .split(/(?=^diff --git )/m)
      .filter((chunk) => chunk.startsWith("diff --git "));
    return chunks
      .map((diff) => ({
        path: (() => {
          const header =
            /^diff --git (?:"a\/.*" "b\/([^"]+)"|a\/.* b\/(.*))$/m.exec(diff);
          return header?.[1] || header?.[2] || "未知文件";
        })(),
        diff,
        kind: diffChangeKind(diff),
        ...diffStats(diff),
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [commitDiff.data]);
  const historyFilteredFiles = useMemo(() => {
    const chunks = (commitDiffFiltered.data || "")
      .split(/(?=^diff --git )/m)
      .filter((chunk) => chunk.startsWith("diff --git "));
    return chunks
      .map((diff) => ({
        path: (() => {
          const header =
            /^diff --git (?:"a\/.*" "b\/([^"]+)"|a\/.* b\/(.*))$/m.exec(diff);
          return header?.[1] || header?.[2] || "未知文件";
        })(),
        diff,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [commitDiffFiltered.data]);
  const historyRawFile = historyFile
    ? historyFiles.find((item) => item.path === historyFile)
    : undefined;
  const historyDisplayText = historyFile
    ? historyFilteredFiles.find((item) => item.path === historyFile)?.diff ||
      ""
    : commitDiffFiltered.data || "";
  const historyRawStats = historyRawFile
    ? {
        additions: historyRawFile.insertions,
        deletions: historyRawFile.deletions,
      }
    : {
        additions: commit?.insertions || 0,
        deletions: commit?.deletions || 0,
      };
  const historyFilteredStats = diffStats(historyDisplayText);
  const historyIgnored = Math.max(
    0,
    historyRawStats.additions +
      historyRawStats.deletions -
      historyFilteredStats.insertions -
      historyFilteredStats.deletions,
  );
  const historyFileInfo = useQuery({
    queryKey: ["git", "commit-file-info", c.id, commit?.hash, historyFile],
    queryFn: () =>
      api("GitCommitFileInfo", c.id, commit!.hash, historyFile),
    enabled: tab === "history" && !!commit && !!historyFile,
  });
  const historyMedia = useQuery({
    queryKey: ["git", "commit-file-preview", c.id, commit?.hash, historyFile],
    queryFn: () =>
      api("GitCommitFilePreview", c.id, commit!.hash, historyFile),
    enabled:
      tab === "history" &&
      !!commit &&
      !!historyFile &&
      ["image", "audio", "video"].includes(
        historyFileInfo.data?.previewKind || "",
      ) &&
      !historyFileInfo.data?.tooLarge,
  });
  const historyBinary = useQuery({
    queryKey: ["git", "commit-binary-diff", c.id, commit?.hash, historyFile],
    queryFn: () =>
      api("GitCommitBinaryDiff", c.id, commit!.hash, historyFile),
    enabled:
      tab === "history" &&
      !!commit &&
      !!historyFile &&
      historyFileInfo.data?.previewKind === "unsupported",
  });
  const account = st.accounts.find((a) => a.id === accountID),
    profile = effectiveCommitIdentity(
      st,
      c,
      st.profiles.find((p) => p.accountId === accountID),
      !!accountID,
    );
  const authorAccounts = new Set(
    st.profiles
      .filter((p) => p.name === profile?.name && p.email === profile?.email)
      .map((p) => p.accountId),
  );
  const authorAccountID =
    profile && "accountId" in profile
      ? profile.accountId
      : authorAccounts.size === 1
        ? [...authorAccounts][0]
        : "";
  const authorAccount = st.accounts.find((a) => a.id === authorAccountID);
  const stage = (f: FileStatus) => void stageFiles([f], !fullyStaged(f));
  const editingFile = files.find((f) => f.path === editing);
  const editStats = editingFile ? fileStats(editingFile) : { additions: 0, deletions: 0 };
  const editorLineCount = editorText ? editorText.split("\n").length : 1;
  const editorLanguage =
    languageOverrides[editing] || detectLanguage(editing);
  const editable = (f?: FileStatus) =>
    !!f && f.worktree !== "D" && f.index !== "D";
  const commitNow = async () => {
    const taskId = await api("CommitChanges", c.id, remote, draft);
    useUI.getState().submitCommitDraft(c.id, taskId, draft);
  };
  const requestCommit = async () => {
    if (!summary.trim() || !profile) return;
    await execute(async () => {
      setSending(true);
      try {
        const risks = await api(
          "CheckLineEndingRisks",
          c.id,
          staged.map((file) => file.path),
        );
        if (risks.length) {
          setLineEndingError("");
          setLineEndingRisks(risks);
          return;
        }
        await commitNow();
      } finally {
        setSending(false);
      }
    });
  };
  const fixAndCommit = async () => {
    if (!lineEndingRisks) return;
    setLineEndingError("");
    await execute(async () => {
      setLineEndingBusy(true);
      try {
        const paths = lineEndingRisks.map((risk) => risk.path);
        await api("FixLineEndings", c.id, paths);
        await client.invalidateQueries({ queryKey: ["git", "status", c.id] });
        await client.invalidateQueries({ queryKey: ["git", "diff", c.id] });
        const remaining = await api("CheckLineEndingRisks", c.id, paths);
        if (remaining.length) {
          setLineEndingRisks(remaining);
          setLineEndingError(
            "仍有文件存在换行符风险，请检查 .gitattributes 或手动处理后重试",
          );
          return;
        }
        setLineEndingRisks(undefined);
        await commitNow();
      } finally {
        setLineEndingBusy(false);
      }
    });
  };
  const commitAsIs = async () => {
    setLineEndingRisks(undefined);
    await execute(async () => {
      setSending(true);
      try {
        await commitNow();
      } finally {
        setSending(false);
      }
    });
  };
  const openWorking = (path: string, kind: string) => {
    void execute(() =>
      api("OpenWorkingPath", c.id, path, kind),
    );
  };
  const changeFormat = (encoding: string, lineEnding: string) => {
    if (!infoPath || formatBusy) return;
    if (editing && editorText !== editorOriginal) {
      window.alert("文件还有未保存的修改，请先保存后再切换编码或换行符。");
      return;
    }
    void execute(async () => {
      setFormatBusy(true);
      try {
        await api("SetWorkingFileFormat", c.id, infoPath, encoding, lineEnding);
        await refreshWorkingTree();
        if (editing) {
          const content = await api("GitFileContent", c.id, editing);
          setEditorText(content);
          setEditorOriginal(content);
        }
      } finally {
        setFormatBusy(false);
      }
    });
  };
  return (
    <div
      className={`desktop-workspace ${activeFile || commit ? "has-file" : ""} ${tab === "changes" && status && files.length === 0 ? "clean-state" : ""}`}
    >
      {tab === "changes" &&
        fileBarSlot &&
        fileInfo.data &&
        createPortal(
          <FileStatusBar
            info={fileInfo.data}
            busy={formatBusy}
            language={infoLanguage}
            onChange={changeFormat}
            onLanguage={(language) =>
              setLanguageOverrides((old) => ({ ...old, [infoPath]: language }))
            }
            onOpenDefault={() => openWorking(fileInfo.data!.path, "default")}
            onReveal={() => openWorking(fileInfo.data!.path, "reveal")}
          />,
          fileBarSlot,
        )}
      {tab === "history" &&
        fileBarSlot &&
        historyFile &&
        historyFileInfo.data &&
        createPortal(
          <FileStatusBar
            info={historyFileInfo.data}
            busy={false}
            language={detectLanguage(historyFile)}
            readOnly
            onOpenDefault={() => {}}
            onReveal={() => {}}
          />,
          fileBarSlot,
        )}
      <aside className="desktop-sidebar">
        <div className="desktop-tabs" role="tablist" aria-label="仓库内容">
          <button
            role="tab"
            aria-selected={tab === "changes"}
            className={tab === "changes" ? "active" : ""}
            onClick={() => setTab("changes")}
          >
            变更{files.length > 0 && <span>{files.length}</span>}
          </button>
          <button
            role="tab"
            aria-selected={tab === "history"}
            className={tab === "history" ? "active" : ""}
            onClick={() => setTab("history")}
          >
            历史
          </button>
        </div>
        {tab === "changes" ? (
          <>
            <div className="file-view-toggle" role="tablist" aria-label="文件视图">
              <button
                className={fileView === "changes" ? "active" : ""}
                onClick={() => setFileView("changes")}
              >
                变更
              </button>
              <button
                className={fileView === "all" ? "active" : ""}
                onClick={() => setFileView("all")}
              >
                全部
              </button>
            </div>
            <label className="file-filter">
              <Search size={14} />
              <input
                aria-label="筛选文件"
                placeholder="筛选文件…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </label>
            <div className="file-count">
              {fileView === "changes" && (
                <input
                  type="checkbox"
                  aria-label="将全部变更加入提交"
                  disabled={busy || !!statusError || !status || stagingPaths.size > 0 || !files.length}
                  checked={
                    !!files.length &&
                    files.every(fullyStaged)
                  }
                  onChange={(e) => {
                    void stageFiles(files, e.target.checked);
                  }}
                />
              )}
              <span>
                {fileView === "all"
                  ? allFiles.isPending
                    ? "正在读取文件…"
                    : `${allFiles.data?.length ?? 0} 个文件`
                  : status
                    ? `${files.length} 个变更文件`
                    : "正在读取变更…"}
              </span>
              <button
                type="button"
                className="new-file-button"
                title="新建文件"
                onClick={() => startCreate(createBase, "file")}
              >
                <FilePlus2 size={13} />
                新建
              </button>
            </div>
            {stageError && <div className="desktop-stage-error" role="alert">{stageError}</div>}
            <div
              className="desktop-file-list"
              onContextMenu={(event) => {
                if (
                  (event.target as Element).closest(
                    ".desktop-file-row, .tree-folder",
                  )
                )
                  return;
                event.preventDefault();
                setTreeSelected("");
                setMenu({
                  x: Math.min(
                    event.clientX,
                    Math.max(8, window.innerWidth - 220),
                  ),
                  y: Math.min(
                    event.clientY,
                    Math.max(8, window.innerHeight - 180),
                  ),
                  node: {
                    name: "",
                    path: "",
                    isDir: true,
                    children: [],
                  },
                });
              }}
            >
              {fileView === "all" && allFiles.isPending ? (
                <Loading />
              ) : fileView === "all" && allFiles.isError ? (
                <ErrorNotice message={errorMessage(allFiles.error)} />
              ) : (
                <>
                  {renderTree(tree, 0)}
                  {!filtered.length && !!sourceFiles.length && (
                    <p className="desktop-list-empty">没有匹配的文件</p>
                  )}
                  {!sourceFiles.length && fileView === "all" && (
                    <p className="desktop-list-empty">仓库中还没有文件</p>
                  )}
                </>
              )}
            </div>
            <form
              className="desktop-commit"
              onSubmit={(e) => {
                e.preventDefault();
                if (!summary.trim() || !profile) return;
                void execute(async () => {
                  setSending(true);
                  try {
                    const taskId = await api(
                      "CommitChanges",
                      c.id,
                      remote,
                      draft,
                    );
                    useUI.getState().submitCommitDraft(c.id, taskId, draft);
                  } finally {
                    setSending(false);
                  }
                });
              }}
            >
              <button
                type="button"
                className="commit-identity"
                onClick={configure}
                title={
                  profile
                    ? `${profile.name} <${profile.email}>`
                    : "配置提交身份"
                }
              >
                {authorAccount ? (
                  <AccountAvatar account={authorAccount} size={26} />
                ) : (
                  <span className="commit-avatar">
                    {profile?.name.slice(0, 2).toUpperCase() || "?"}
                  </span>
                )}
                <span>
                  {profile?.name || "配置提交身份"}
                  <small>{profile?.email || "姓名与邮箱尚未确认"}</small>
                </span>
                <Settings2 size={14} />
              </button>
              <input
                aria-label="提交摘要"
                required
                placeholder="提交摘要（必填）"
                value={summary}
                onChange={(e) => writeDraft(e.target.value, description)}
              />
              <textarea
                aria-label="提交描述"
                placeholder="描述（可选）"
                value={description}
                onChange={(e) => writeDraft(summary, e.target.value)}
                rows={4}
              />
              <div className="commit-caption">
                {!profile
                  ? "请先确认仓库身份"
                  : `${staged.length} 个文件已暂存`}
              </div>
              <button
                className="desktop-primary"
                disabled={
                  busy ||
                  sending ||
                  !!submission ||
                  stagingPaths.size > 0 ||
                  verifying ||
                  !staged.length ||
                  !summary.trim() ||
                  !profile
                }
              >
                提交到 {status?.branch || "当前分支"}
              </button>
            </form>
          </>
        ) : (
          <div className="desktop-history-list">
            {history.isPending ? (
              <Loading />
            ) : history.isError ? (
              <ErrorNotice message={errorMessage(history.error)} />
            ) : history.data?.length ? (
              history.data.map((item) => {
                const labels = commitPills(item);
                return (
                <button
                  className={commit?.hash === item.hash ? "selected" : ""}
                  key={item.hash}
                  onClick={() => { setCommitHash(item.hash); setHistoryFile(""); setCollapsedFolders(new Set()); }}
                >
                  <GitCommitHorizontal size={16} />
                  <span>
                    <strong>{item.subject}</strong>
                    {labels.length > 0 && (
                      <span className="commit-labels">
                        {labels.map((label) => (
                          <span
                            key={label.key}
                            className={label.className}
                            title={label.title}
                          >
                            {label.label}
                          </span>
                        ))}
                      </span>
                    )}
                    <small>
                      {item.author} · <RelativeTime date={item.date} />
                    </small>
                    <small className="history-stats">
                      <span>{item.files} 个文件</span>
                      <span className="stat-add">+{item.insertions}</span>
                      <span className="stat-del">−{item.deletions}</span>
                    </small>
                  </span>
                </button>
                );
              })
            ) : (
              <p className="desktop-list-empty">还没有提交记录</p>
            )}
          </div>
        )}
      </aside>
      <main className="desktop-detail">
        {statusError ? (
          <div className="desktop-block-error">
            <ErrorNotice message={statusError} />
          </div>
        ) : tab === "history" ? (
          commit ? (
            <>
              <div className="desktop-diff-header">
                <GitCommitHorizontal size={16} />
                <strong>{commit.subject}</strong>
                <code>{commit.hash.slice(0, 7)}</code>
              </div>
              <div className="desktop-commit-info">
                {commit.author} &lt;{commit.email}&gt; ·{" "}
                {new Date(commit.date).toLocaleString("zh-CN")}
              </div>
              {commitDiff.isPending || commitDiffFiltered.isPending ? (
                <Loading />
              ) : commitDiff.isError ? (
                <ErrorNotice message={errorMessage(commitDiff.error)} />
              ) : commitDiffFiltered.isError ? (
                <ErrorNotice message={errorMessage(commitDiffFiltered.error)} />
              ) : (
                <div className="desktop-history-content">
                  <nav className="desktop-history-tree" aria-label="提交文件树">
                    <div className="history-tree-heading">文件变更 <span>{historyFiles.length}</span></div>
                    <button className={!historyFile ? "selected" : ""} onClick={() => setHistoryFile("")}>全部文件</button>
                    {historyFiles.flatMap(({ path, kind }, index) => {
                      const parts = path.split("/");
                      const folders = parts.slice(0, -1);
                      const visible = folders.every((_, level) => !collapsedFolders.has(folders.slice(0, level + 1).join("/")));
                      const previous = historyFiles[index - 1]?.path.split("/") || [];
                      const folderRows = folders.flatMap((name, level) => {
                        const folderPath = folders.slice(0, level + 1).join("/");
                        if (previous.slice(0, level + 1).join("/") === folderPath || folders.slice(0, level).some((_, parent) => collapsedFolders.has(folders.slice(0, parent + 1).join("/")))) return [];
                        return <button key={`folder:${folderPath}`} className="history-folder" style={{ paddingLeft: 10 + level * 13 }} aria-expanded={!collapsedFolders.has(folderPath)} onClick={() => setCollapsedFolders((old) => { const next = new Set(old); if (next.has(folderPath)) next.delete(folderPath); else next.add(folderPath); return next; })}>
                          <ChevronDown size={13} className={collapsedFolders.has(folderPath) ? "collapsed" : ""} /><span>{name}</span>
                        </button>;
                      });
                      return [...folderRows, ...(visible ? [<button key={`file:${path}`} className={`history-file-${kind}${historyFile === path ? " selected" : ""}`} style={{ paddingLeft: 10 + folders.length * 13 }} title={path} onClick={() => setHistoryFile(path)}>
                        <FileText size={14} /><span>{parts.at(-1)}</span>
                      </button>] : [])];
                    })}
                  </nav>
                  {historyFile && historyFileInfo.isPending ? (
                    <Loading />
                  ) : historyFile && historyFileInfo.isError ? (
                    <ErrorNotice message={errorMessage(historyFileInfo.error)} />
                  ) : historyFile &&
                    historyFileInfo.data?.previewKind === "unsupported" ? (
                    <BinaryDiffPane
                      info={historyFileInfo.data}
                      diff={historyBinary.data}
                      loading={historyBinary.isFetching}
                      error={
                        historyBinary.isError
                          ? errorMessage(historyBinary.error)
                          : ""
                      }
                    />
                  ) : historyFile &&
                    ["image", "audio", "video"].includes(
                      historyFileInfo.data?.previewKind || "",
                    ) ? (
                    <CommitMediaPreview
                      info={historyFileInfo.data!}
                      preview={historyMedia.data}
                      loading={historyMedia.isFetching}
                      error={
                        historyMedia.isError
                          ? errorMessage(historyMedia.error)
                          : ""
                      }
                    />
                  ) : (
                    <DiffViewer
                      key={commit.hash + historyFile}
                      text={historyDisplayText}
                      stats={historyRawStats}
                      ignored={historyIgnored}
                    />
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="desktop-empty-detail">
              <Clock3 size={36} strokeWidth={1.3} />
              <h2>提交历史</h2>
              <p>在左侧选择一个提交，查看完整差异。</p>
            </div>
          )
        ) : editing ? (
          <div className="desktop-editor">
            <div className="desktop-diff-header">
              <button
                className="desktop-back"
                aria-label="返回差异"
                onClick={closeEditor}
              >
                <ArrowLeft size={16} />
              </button>
              <FileText size={16} />
              <strong>{editing}</strong>
              <span>
                {editorLineCount} 行 · 第 {cursorLine} 行
              </span>
              <span className="file-line-stats">
                {editStats.additions > 0 && (
                  <span className="stat-add">+{editStats.additions}</span>
                )}
                {editStats.deletions > 0 && (
                  <span className="stat-del">−{editStats.deletions}</span>
                )}
              </span>
              <span className="editor-actions">
                <button
                  onClick={saveEditor}
                  disabled={
                    editorSaving ||
                    editorLoading ||
                    editorText === editorOriginal
                  }
                >
                  <Save size={14} />
                  {editorSaving ? "保存中…" : "保存"}
                </button>
                <button onClick={closeEditor}>关闭</button>
              </span>
            </div>
            {editorError && (
              <div className="desktop-block-error">
                <ErrorNotice message={editorError} />
              </div>
            )}
            {editorLoading ? (
              <Loading />
            ) : (
              <div className="editor-body">
                <pre ref={gutterRef} className="editor-gutter" aria-hidden="true">
                  {Array.from(
                    { length: editorLineCount },
                    (_, index) => index + 1,
                  ).join("\n")}
                </pre>
                <div className="editor-code">
                  <pre
                    ref={editorHighlightRef}
                    className="editor-highlight"
                    aria-hidden="true"
                  >
                    <code
                      dangerouslySetInnerHTML={{
                        __html: highlightCode(
                          editorText + "\n",
                          editorLanguage,
                        ),
                      }}
                    />
                  </pre>
                  <textarea
                    ref={editorRef}
                    aria-label={`编辑 ${editing}`}
                    value={editorText}
                    spellCheck={false}
                    wrap="off"
                    onChange={(e) => {
                      setEditorText(e.target.value);
                      updateCursorLine();
                    }}
                    onScroll={(e) => {
                      if (gutterRef.current)
                        gutterRef.current.scrollTop = e.currentTarget.scrollTop;
                      if (editorHighlightRef.current) {
                        editorHighlightRef.current.scrollTop =
                          e.currentTarget.scrollTop;
                        editorHighlightRef.current.scrollLeft =
                          e.currentTarget.scrollLeft;
                      }
                    }}
                    onClick={updateCursorLine}
                    onKeyUp={updateCursorLine}
                    onSelect={updateCursorLine}
                    onKeyDown={(e) => {
                      if (
                        (e.ctrlKey || e.metaKey) &&
                        e.key.toLowerCase() === "s"
                      ) {
                        e.preventDefault();
                        void saveEditor();
                      }
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        ) : previewPath ? (
          <FilePreviewPane
            path={previewPath}
            info={fileInfo.data}
            preview={preview.data}
            text={previewText.data}
            language={infoLanguage}
            loading={
              fileInfo.isPending ||
              preview.isFetching ||
              previewText.isFetching
            }
            error={
              fileInfo.isError
                ? errorMessage(fileInfo.error)
                : preview.isError
                  ? errorMessage(preview.error)
                  : previewText.isError
                    ? errorMessage(previewText.error)
                    : ""
            }
            onClose={() => {
              setPreviewPath("");
              setSelected(undefined);
            }}
            onEdit={() => void openEditor(previewPath)}
            onOpenDefault={() => openWorking(previewPath, "default")}
            onReveal={() => openWorking(previewPath, "reveal")}
          />
        ) : activeFile ? (
          <>
            <div className="desktop-diff-header">
              <button
                className="desktop-back"
                aria-label="返回变更列表"
                onClick={() => setSelected(undefined)}
              >
                <ArrowLeft size={16} />
              </button>
              <FileText size={16} />
              <strong>{activeFile.path}</strong>
              <span>{activeFile.staged ? "已暂存" : "工作区"}</span>
              {file && (
                <span className="file-line-stats">
                  {fileStats(file).additions > 0 && (
                    <span className="stat-add">
                      +{fileStats(file).additions}
                    </span>
                  )}
                  {fileStats(file).deletions > 0 && (
                    <span className="stat-del">
                      −{fileStats(file).deletions}
                    </span>
                  )}
                </span>
              )}
              <button
                className="diff-edit-button"
                disabled={!editable(file)}
                title={editable(file) ? "在应用内编辑文件" : "该文件不可编辑"}
                onClick={() => void openEditor(activeFile.path)}
              >
                <Pencil size={14} />
                编辑
              </button>
            </div>
            {diff.isPending ? (
              <Loading />
            ) : diff.isError ? (
              <ErrorNotice message={errorMessage(diff.error)} />
            ) : diff.data || activeIgnored > 0 ? (
              <DiffViewer
                key={activeFile.path + activeFile.staged}
                text={diff.data || ""}
                stats={activeRawStats}
                ignored={activeIgnored}
                showFileHeaders={false}
              />
            ) : (
              <div className="desktop-empty-detail">
                <FileText size={32} />
                <h2>暂无文本差异</h2>
                <p>
                  {file?.index === "?"
                    ? "新文件尚未跟踪。勾选文件加入暂存后可查看差异。"
                    : "差异为空：可能仅包含换行符变化（已忽略），或为二进制、重命名、文件属性变化。"}
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="desktop-start">
            <h2>
              {!status
                ? "正在读取仓库…"
                : files.length
                  ? "查看你的修改"
                  : "没有本地变更"}
            </h2>
            <p className="desktop-checkout-path">{c.path}</p>
            {files.length > 0 && <p>选择左侧文件查看差异。</p>}
            <div className="desktop-next-actions">
              <ActionRow
                title="在外部编辑器中打开仓库"
                action="打开编辑器"
                onClick={() =>
                  void execute(() => api("OpenCheckout", c.id, "editor"))
                }
              />
              <ActionRow
                title="在文件夹中查看仓库"
                action="打开文件夹"
                onClick={() =>
                  void execute(() => api("OpenCheckout", c.id, "folder"))
                }
              />
              {row.repository && (
                <ActionRow
                  title="在 GitHub 中查看仓库"
                  action="查看 GitHub"
                  onClick={openRepository}
                />
              )}
            </div>
            {!remote ? (
              <p className="desktop-context-note">
                请选择有效的 remote 并确认身份。
                <button onClick={configure}>仓库设置</button>
              </p>
            ) : !profile ? (
              <p className="desktop-context-note">
                此本地副本尚未绑定提交身份。
                <button onClick={configure}>配置身份</button>
              </p>
            ) : account?.status === "auth_required" ? (
              <p className="desktop-context-note">
                {account.login} 需要重新授权；本地提交仍可使用。
                <button onClick={accountSettings}>管理账号</button>
              </p>
            ) : null}
          </div>
        )}
      </main>
      {lineEndingRisks && (
        <Modal
          title="检测到换行符风险"
          onClose={() => {
            if (!lineEndingBusy) setLineEndingRisks(undefined);
          }}
        >
          <p>以下文件包含混合换行符，或与仓库的 eol 规则不一致：</p>
          <div className="line-ending-list">
            {lineEndingRisks.map((risk) => (
              <div className="line-ending-row" key={risk.path}>
                <code>{risk.path}</code>
                <span>
                  {risk.mixed ? "混合" : risk.policy ? `规则 ${risk.policy}` : "风险"}
                </span>
                <small>
                  CRLF {risk.crlf} · LF {risk.lf}
                </small>
              </div>
            ))}
          </div>
          <p className="subtle-note">
            存在 .gitattributes 时将优先按其 eol 规则修复；没有显式规则时按 Git 文本规则规范化为 LF。
          </p>
          {lineEndingError && (
            <div className="desktop-stage-error" role="alert">
              {lineEndingError}
            </div>
          )}
          <div className="form-actions">
            <button
              type="button"
              disabled={lineEndingBusy}
              onClick={() => setLineEndingRisks(undefined)}
            >
              取消
            </button>
            <button
              type="button"
              disabled={lineEndingBusy}
              onClick={() => void commitAsIs()}
            >
              原样提交
            </button>
            <button
              type="button"
              className="primary"
              disabled={lineEndingBusy}
              onClick={() => void fixAndCommit()}
            >
              {lineEndingBusy ? "正在修复…" : "按 Git 规则修复并提交"}
            </button>
          </div>
        </Modal>
      )}
      {menu && (
        <div
          className="desktop-context-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
        >
          {menu.node.isDir ? (
            <>
              <button onClick={() => startCreate(menu.node.path, "file")}>
                <FilePlus2 size={14} />
                {menu.node.path ? "新建子文件…" : "新建文件…"}
              </button>
              <button onClick={() => startCreate(menu.node.path, "dir")}>
                <FolderPlus size={14} />
                {menu.node.path ? "新建子目录…" : "新建目录…"}
              </button>
              <button onClick={() => openWorking(menu.node.path, "folder")}>
                <FolderOpen size={14} />
                打开文件夹
              </button>
              <button onClick={() => openWorking(menu.node.path, "terminal")}>
                <Terminal size={14} />
                在终端中打开
              </button>
              {clipboard && (
                <button onClick={() => pasteInto(menu.node)}>
                  <ClipboardPaste size={14} />
                  粘贴{clipboard.cut ? "（移动）" : ""}
                </button>
              )}
              {menu.node.path &&
                flattenTree(menu.node).some(isChanged) && (
                  <button
                    onClick={() =>
                      stageNode(menu.node, !nodeStaged(menu.node))
                    }
                  >
                    {nodeStaged(menu.node) ? "取消暂存目录" : "暂存目录"}
                  </button>
                )}
              {menu.node.path && (
                <button onClick={() => ignoreNode(menu.node)}>
                  <EyeOff size={14} />
                  添加到 .gitignore
                </button>
              )}
              {menu.node.path &&
                flattenTree(menu.node).some(
                  (file) => file.tracked ?? file.index !== "?",
                ) && (
                  <button onClick={() => untrackNode(menu.node)}>
                    <Trash2 size={14} />
                    移除 Git 跟踪
                  </button>
                )}
              {menu.node.path && (
                <>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(menu.node.path);
                      setMenu(undefined);
                    }}
                  >
                    <Copy size={14} />
                    复制相对路径
                  </button>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(menu.node.name);
                      setMenu(undefined);
                    }}
                  >
                    <Copy size={14} />
                    复制名称
                  </button>
                  <button onClick={() => copyEntry(menu.node, false)}>
                    <Copy size={14} />
                    复制
                  </button>
                  <button onClick={() => copyEntry(menu.node, true)}>
                    <Scissors size={14} />
                    剪切
                  </button>
                  <button
                    onClick={() => {
                      setRenameTarget(menu.node);
                      setRenameName(menu.node.name);
                      setRenameError("");
                      setMenu(undefined);
                    }}
                  >
                    <Pencil size={14} />
                    重命名…
                  </button>
                  <button onClick={() => removeEntry(menu.node)}>
                    <Trash2 size={14} />
                    删除…
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <button onClick={() => openPreview(menu.node.path)}>
                <Eye size={14} />
                预览
              </button>
              <button
                disabled={!editable(menu.node.file)}
                onClick={() => void openEditor(menu.node.path)}
              >
                <Pencil size={14} />
                编辑文件
              </button>
              <button onClick={() => openWorking(menu.node.path, "default")}>
                <ExternalLink size={14} />
                用默认应用打开
              </button>
              <button onClick={() => openWorking(menu.node.path, "reveal")}>
                <FolderOpen size={14} />
                打开文件所在位置
              </button>
              <button onClick={() => startCreate(parentPath(menu.node.path), "file")}>
                <FilePlus2 size={14} />
                新建同级文件…
              </button>
              <button onClick={() => startCreate(parentPath(menu.node.path), "dir")}>
                <FolderPlus size={14} />
                新建同级目录…
              </button>
              <button onClick={() => pasteInto(menu.node)} disabled={!clipboard}>
                <ClipboardPaste size={14} />
                粘贴{clipboard?.cut ? "（移动）" : ""}
              </button>
              {isChanged(menu.node.file!) && (
                <button
                  onClick={() =>
                    stageNode(menu.node, !nodeStaged(menu.node))
                  }
                >
                  {nodeStaged(menu.node) ? "取消暂存" : "暂存"}
                </button>
              )}
              <button onClick={() => ignoreNode(menu.node)}>
                <EyeOff size={14} />
                添加到 .gitignore
              </button>
              {(menu.node.file!.tracked ??
                menu.node.file!.index !== "?") && (
                <button onClick={() => untrackNode(menu.node)}>
                  <Trash2 size={14} />
                  移除 Git 跟踪
                </button>
              )}
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(menu.node.path);
                  setMenu(undefined);
                }}
              >
                <Copy size={14} />
                复制相对路径
              </button>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(menu.node.name);
                  setMenu(undefined);
                }}
              >
                <Copy size={14} />
                复制文件名
              </button>
              <button onClick={() => copyEntry(menu.node, false)}>
                <Copy size={14} />
                复制
              </button>
              <button onClick={() => copyEntry(menu.node, true)}>
                <Scissors size={14} />
                剪切
              </button>
              <button
                onClick={() => {
                  setRenameTarget(menu.node);
                  setRenameName(menu.node.name);
                  setRenameError("");
                  setMenu(undefined);
                }}
              >
                <Pencil size={14} />
                重命名…
              </button>
              <button onClick={() => removeEntry(menu.node)}>
                <Trash2 size={14} />
                删除…
              </button>
            </>
          )}
        </div>
      )}
      {newFileOpen && (
        <Modal
          title={newItemKind === "dir" ? "新建目录" : "新建文件"}
          onClose={() => setNewFileOpen(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void createFile();
            }}
          >
            <Field
              label={newItemKind === "dir" ? "目录路径" : "文件路径"}
              hint="相对仓库根目录，例如 src/new.ts"
            >
              <input
                autoFocus
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                placeholder={newItemKind === "dir" ? "src/new-folder" : "src/new.ts"}
              />
            </Field>
            {newFileError && (
              <div className="desktop-stage-error" role="alert">
                {newFileError}
              </div>
            )}
            <div className="form-actions">
              <button type="button" onClick={() => setNewFileOpen(false)}>
                取消
              </button>
              <button className="primary" disabled={!newFileName.trim()}>
                创建
              </button>
            </div>
          </form>
        </Modal>
      )}
      {renameTarget && (
        <Modal
          title="重命名"
          onClose={() => setRenameTarget(undefined)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void renameEntry();
            }}
          >
            <Field label="新名称" hint={renameTarget.path}>
              <input
                autoFocus
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
              />
            </Field>
            {renameError && (
              <div className="desktop-stage-error" role="alert">
                {renameError}
              </div>
            )}
            <div className="form-actions">
              <button
                type="button"
                onClick={() => setRenameTarget(undefined)}
              >
                取消
              </button>
              <button
                className="primary"
                disabled={!renameName.trim() || renameName === renameTarget.name}
              >
                重命名
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
type FileTreeNode = {
  name: string;
  path: string;
  isDir: boolean;
  file?: FileStatus;
  children: FileTreeNode[];
};

function parentPath(path: string) {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function findTreeNode(
  nodes: FileTreeNode[],
  path: string,
): FileTreeNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node;
    const found = findTreeNode(node.children, path);
    if (found) return found;
  }
  return undefined;
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
}

const commitTypeLabels: Record<string, string> = {
  feat: "功能",
  fix: "修复",
  hotfix: "修复",
  docs: "文档",
  style: "样式",
  refactor: "重构",
  perf: "性能",
  test: "测试",
  build: "构建",
  ci: "CI",
  chore: "杂项",
  revert: "回滚",
  release: "发布",
};

type CommitPill = { key: string; label: string; className: string; title: string };

function commitPills(commit: Commit): CommitPill[] {
  const pills: CommitPill[] = [];
  const typeMatch = /^([a-zA-Z]+)(?:\([^)]*\))?!?:/.exec(commit.subject);
  const type = typeMatch?.[1]?.toLowerCase() || "";
  if (commitTypeLabels[type]) {
    pills.push({
      key: `type:${type}`,
      label: commitTypeLabels[type],
      className: `commit-pill type-${type}`,
      title: `提交类型：${type}`,
    });
  }
  if (commit.parents > 1) {
    pills.push({
      key: "merge",
      label: "合并",
      className: "commit-pill merge",
      title: "合并提交",
    });
  }
  const tags = commit.tags || [];
  const release =
    type !== "release" &&
    (/^(?:chore\()?release(?:\)[^:]*)?!?:/i.test(commit.subject) ||
      tags.some(
        (tag) =>
          /release/i.test(tag) ||
          /^v?\d+(?:\.\d+){1,2}(?:[-+].*)?$/i.test(tag),
      ));
  if (release) {
    pills.push({
      key: "release",
      label: "发布",
      className: "commit-pill release",
      title: "发布版本",
    });
  }
  tags.slice(0, 2).forEach((tag) =>
    pills.push({
      key: `tag:${tag}`,
      label: tag,
      className: "commit-pill tag",
      title: `标签：${tag}`,
    }),
  );
  if (tags.length > 2) {
    pills.push({
      key: "tag-more",
      label: `+${tags.length - 2}`,
      className: "commit-pill tag",
      title: tags.slice(2).join(", "),
    });
  }
  return pills;
}

function formatSyncTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return date.toLocaleString("zh-CN", {
    ...(sameDay ? {} : { month: "2-digit", day: "2-digit" }),
    hour: "2-digit",
    minute: "2-digit",
  });
}

function FileStatusBar({
  info,
  busy,
  language,
  readOnly = false,
  onChange,
  onLanguage,
  onOpenDefault,
  onReveal,
}: {
  info: WorkingFileInfo;
  busy: boolean;
  language: LanguageId;
  readOnly?: boolean;
  onChange?: (encoding: string, lineEnding: string) => void;
  onLanguage?: (language: LanguageId) => void;
  onOpenDefault: () => void;
  onReveal: () => void;
}) {
  const [open, setOpen] = useState<
    "encoding" | "lineEnding" | "language" | ""
  >("");
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element).closest(".filebar-format")) setOpen("");
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  if (info.isDir) return null;
  const textEditable =
    info.previewKind === "text" && !info.binary && !info.tooLarge;
  const textFile = info.previewKind === "text";
  const lineEnding =
    info.lineEnding === "LF" ||
    info.lineEnding === "CRLF" ||
    info.lineEnding === "CR"
      ? info.lineEnding
      : "LF";
  if (readOnly) {
    return (
      <div className="desktop-filebar">
        <span className="filebar-path" title={info.path}>
          {info.path}
        </span>
        <span className="filebar-size">{formatBytes(info.size)}</span>
        <span className="filebar-readonly">
          {info.binary ? info.mimeType || "二进制" : info.encoding}
        </span>
        {!info.binary && (
          <span className="filebar-readonly">
            {info.lineEnding === "None" ? "无换行" : info.lineEnding}
          </span>
        )}
        {textFile && (
          <span className="filebar-readonly">{languageLabel(language)}</span>
        )}
        <span className="filebar-readonly">历史版本 · 只读</span>
      </div>
    );
  }
  return (
    <div className="desktop-filebar">
      <span className="filebar-path" title={info.path}>
        {info.path}
      </span>
      <span className="filebar-size">{formatBytes(info.size)}</span>
      {textFile && (
        <div className="filebar-format">
          <button
            type="button"
            title="切换代码识别格式（仅影响预览）"
            onClick={() => setOpen(open === "language" ? "" : "language")}
          >
            {languageLabel(language)}
          </button>
          {open === "language" && (
            <div className="filebar-menu filebar-language-menu">
              {LANGUAGES.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={item.id === language ? "active" : ""}
                  onClick={() => {
                    setOpen("");
                    onLanguage?.(item.id);
                  }}
                >
                  {item.label}
                  {item.id === language && <Check size={12} />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="filebar-format">
        <button
          type="button"
          disabled={!textEditable || busy}
          title={textEditable ? "切换编码" : "该文件不能切换文本编码"}
          onClick={() => setOpen(open === "encoding" ? "" : "encoding")}
        >
          {info.encoding}
        </button>
        {open === "encoding" && (
          <div className="filebar-menu">
            {["UTF-8", "UTF-8 BOM", "UTF-16 LE", "UTF-16 BE"].map((value) => (
              <button
                type="button"
                key={value}
                className={value === info.encoding ? "active" : ""}
                onClick={() => {
                  setOpen("");
                  onChange?.(value, lineEnding);
                }}
              >
                {value}
                {value === info.encoding && <Check size={12} />}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="filebar-format">
        <button
          type="button"
          disabled={!textEditable || busy || info.lineEnding === "None"}
          title={textEditable ? "切换换行符" : "该文件不能切换换行符"}
          onClick={() => setOpen(open === "lineEnding" ? "" : "lineEnding")}
        >
          {info.lineEnding === "None" ? "无换行" : info.lineEnding}
        </button>
        {open === "lineEnding" && (
          <div className="filebar-menu">
            {[
              ["LF", "LF（Unix）"],
              ["CRLF", "CRLF（Windows）"],
              ["CR", "CR（旧版 Mac）"],
            ].map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={value === info.lineEnding ? "active" : ""}
                onClick={() => {
                  setOpen("");
                  onChange?.(
                    ["UTF-8", "UTF-8 BOM", "UTF-16 LE", "UTF-16 BE"].includes(
                      info.encoding,
                    )
                      ? info.encoding
                      : "UTF-8",
                    value,
                  );
                }}
              >
                {label}
                {value === info.lineEnding && <Check size={12} />}
              </button>
            ))}
          </div>
        )}
      </div>
      {!textEditable && (
        <>
          <button type="button" className="filebar-action" onClick={onOpenDefault}>
            <ExternalLink size={12} />
            默认应用打开
          </button>
          <button type="button" className="filebar-action" onClick={onReveal}>
            <FolderOpen size={12} />
            所在位置
          </button>
        </>
      )}
    </div>
  );
}

function FilePreviewPane({
  path,
  info,
  preview,
  text,
  language,
  loading,
  error,
  onClose,
  onEdit,
  onOpenDefault,
  onReveal,
}: {
  path: string;
  info?: WorkingFileInfo;
  preview?: WorkingFilePreview;
  text?: string;
  language: LanguageId;
  loading: boolean;
  error: string;
  onClose: () => void;
  onEdit: () => void;
  onOpenDefault: () => void;
  onReveal: () => void;
}) {
  const kind = info?.previewKind;
  const needsPreview =
    !!info &&
    ["image", "audio", "video"].includes(info.previewKind) &&
    !info.tooLarge;
  const source = preview
    ? `data:${preview.mimeType};base64,${preview.data}`
    : "";
  return (
    <div className="desktop-preview-pane">
      <div className="desktop-diff-header">
        <button className="desktop-back" aria-label="返回文件列表" onClick={onClose}>
          <ArrowLeft size={16} />
        </button>
        {kind === "image" ? (
          <ImageIcon size={16} />
        ) : kind === "audio" ? (
          <Music size={16} />
        ) : kind === "video" ? (
          <Video size={16} />
        ) : (
          <FileQuestion size={16} />
        )}
        <strong>{path}</strong>
        {info && (
          <>
            <span>{info.encoding}</span>
            <span>{info.lineEnding === "None" ? "无换行" : info.lineEnding}</span>
            <span>{formatBytes(info.size)}</span>
            {info.previewKind === "text" && (
              <span>{languageLabel(language)}</span>
            )}
          </>
        )}
        <span className="editor-actions">
          {info?.editable && (
            <button onClick={onEdit}>
              <Pencil size={14} />
              编辑
            </button>
          )}
          <button onClick={onOpenDefault}>
            <ExternalLink size={14} />
            默认应用
          </button>
          <button onClick={onReveal}>
            <FolderOpen size={14} />
            所在位置
          </button>
        </span>
      </div>
      {loading || (needsPreview && !preview && !error) ? (
        <Loading />
      ) : error ? (
        <div className="desktop-preview-empty">
          <FileQuestion size={42} strokeWidth={1.3} />
          <h2>无法预览此文件</h2>
          <p>{error}</p>
          <div className="form-actions">
            <button onClick={onOpenDefault}>用默认应用打开</button>
            <button onClick={onReveal}>打开文件所在位置</button>
          </div>
        </div>
      ) : !info ? (
        <Loading />
      ) : info.previewKind === "unsupported" || info.tooLarge ? (
        <div className="desktop-preview-empty">
          <FileQuestion size={42} strokeWidth={1.3} />
          <h2>{info.tooLarge ? "文件过大" : "不支持内置预览"}</h2>
          <p>
            {info.tooLarge
              ? "文件超过 32 MiB，请使用默认应用打开。"
              : `${info.mimeType || "二进制文件"}，可以使用默认应用查看。`}
          </p>
          <div className="form-actions">
            <button onClick={onOpenDefault}>用默认应用打开</button>
            <button onClick={onReveal}>打开文件所在位置</button>
          </div>
        </div>
      ) : info.previewKind === "image" && source ? (
        <div className="desktop-preview-media">
          <img src={source} alt={path} />
        </div>
      ) : info.previewKind === "audio" && source ? (
        <div className="desktop-preview-media">
          <Music size={52} strokeWidth={1.2} />
          <audio controls src={source} />
        </div>
      ) : info.previewKind === "video" && source ? (
        <div className="desktop-preview-media">
          <video controls src={source} />
        </div>
      ) : info.previewKind === "text" ? (
        <CodePreview code={text || ""} language={language} />
      ) : (
        <div className="desktop-preview-empty">
          <FileText size={42} strokeWidth={1.3} />
          <h2>文本文件</h2>
          <p>使用内置编辑器查看和修改此文件。</p>
          <div className="form-actions">
            {info.editable && <button onClick={onEdit}>编辑文件</button>}
            <button onClick={onOpenDefault}>用默认应用打开</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CodePreview({ code, language }: { code: string; language: LanguageId }) {
  return (
    <div className="desktop-code-preview">
      <pre>
        <code
          dangerouslySetInnerHTML={{ __html: highlightCode(code, language) }}
        />
      </pre>
    </div>
  );
}

function decodeBase64(value: string) {
  const binary = atob(value || "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function CommitMediaPreview({
  info,
  preview,
  loading,
  error,
}: {
  info: WorkingFileInfo;
  preview?: WorkingFilePreview;
  loading: boolean;
  error: string;
}) {
  const source = preview
    ? `data:${preview.mimeType};base64,${preview.data}`
    : "";
  return (
    <div className="desktop-preview-pane">
      <div className="desktop-diff-header">
        {info.previewKind === "image" ? (
          <ImageIcon size={16} />
        ) : info.previewKind === "audio" ? (
          <Music size={16} />
        ) : (
          <Video size={16} />
        )}
        <strong>{info.path}</strong>
        <span>{info.mimeType}</span>
        <span>{formatBytes(info.size)}</span>
      </div>
      {loading ? (
        <Loading />
      ) : info.tooLarge ? (
        <div className="desktop-preview-empty">
          <FileQuestion size={42} strokeWidth={1.3} />
          <h2>文件过大</h2>
          <p>该媒体文件过大，无法在提交历史中内置预览。</p>
        </div>
      ) : error ? (
        <div className="desktop-preview-empty">
          <FileQuestion size={42} strokeWidth={1.3} />
          <h2>无法预览此媒体文件</h2>
          <p>{error}</p>
        </div>
      ) : info.previewKind === "image" && source ? (
        <div className="desktop-preview-media">
          <img src={source} alt={info.path} />
        </div>
      ) : info.previewKind === "audio" && source ? (
        <div className="desktop-preview-media">
          <Music size={52} strokeWidth={1.2} />
          <audio controls src={source} />
        </div>
      ) : info.previewKind === "video" && source ? (
        <div className="desktop-preview-media">
          <video controls src={source} />
        </div>
      ) : (
        <Loading />
      )}
    </div>
  );
}

function BinaryDiffPane({
  info,
  diff,
  loading,
  error,
}: {
  info: WorkingFileInfo;
  diff?: CommitBinaryDiff;
  loading: boolean;
  error: string;
}) {
  const oldBytes = decodeBase64(diff?.oldData || "");
  const newBytes = decodeBase64(diff?.newData || "");
  const displayBytes = newBytes.length ? newBytes : oldBytes;
  const rows: ReactNode[] = [];
  const limit = Math.min(displayBytes.length, 16 << 10);
  for (let offset = 0; offset < limit; offset += 16) {
    const row = displayBytes.slice(offset, Math.min(limit, offset + 16));
    const hex: ReactNode[] = [];
    const ascii: ReactNode[] = [];
    row.forEach((byte, index) => {
      const position = offset + index;
      const changed =
        !diff?.oldExists ||
        !diff?.newExists ||
        position >= oldBytes.length ||
        oldBytes[position] !== byte;
      const text = byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ".";
      hex.push(
        <span
          key={`h:${position}`}
          className={changed ? "binary-byte changed" : "binary-byte"}
        >
          {byte.toString(16).padStart(2, "0")}
        </span>,
      );
      ascii.push(
        <span
          key={`a:${position}`}
          className={changed ? "binary-byte changed" : "binary-byte"}
        >
          {text}
        </span>,
      );
    });
    rows.push(
      <div className="binary-hex-row" key={offset}>
        <span className="binary-offset">
          {offset.toString(16).padStart(8, "0")}
        </span>
        <span className="binary-hex">{hex}</span>
        <span className="binary-ascii">{ascii}</span>
      </div>,
    );
  }
  return (
    <div className="binary-diff-pane">
      <div className="binary-diff-summary">
        <FileQuestion size={16} />
        <strong>{info.path}</strong>
        <span>{info.mimeType || "application/octet-stream"}</span>
        <span>
          {diff
            ? `${diff.oldExists ? formatBytes(diff.oldSize) : "不存在"} → ${
                diff.newExists ? formatBytes(diff.newSize) : "已删除"
              }`
            : formatBytes(info.size)}
        </span>
        {diff && (
          <span className={diff.changedBytes ? "stat-del" : ""}>
            {diff.changedBytes
              ? `${diff.changedBytes} 个字节不同`
              : diff.oldHash && diff.oldHash === diff.newHash
                ? "文件内容相同"
                : "前 64 KiB 无差异"}
          </span>
        )}
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorNotice message={error} />
      ) : diff ? (
        <>
          <div className="binary-meta">
            <span>
              旧:{diff.oldExists ? diff.oldHash.slice(0, 12) : "不存在"}
            </span>
            <span>
              新:{diff.newExists ? diff.newHash.slice(0, 12) : "已删除"}
            </span>
            {diff.truncated && <span>差异统计基于前 64 KiB</span>}
            <span>十六进制预览前 16 KiB</span>
            {diff.firstDifference >= 0 && (
              <span>首个差异位于 0x{diff.firstDifference.toString(16)}</span>
            )}
          </div>
          <div className="binary-hex-view">
            {rows.length ? rows : <p className="desktop-list-empty">文件为空</p>}
          </div>
        </>
      ) : (
        <Loading />
      )}
    </div>
  );
}

type BranchTreeNode = {
  name: string;
  path: string;
  branch?: Branch;
  children: BranchTreeNode[];
};

function buildBranchTree(branches: Branch[]): BranchTreeNode[] {
  type MutableNode = {
    name: string;
    path: string;
    branch?: Branch;
    children: Map<string, MutableNode>;
  };
  const root = new Map<string, MutableNode>();
  for (const branch of branches) {
    const parts = branch.name.split("/");
    let children = root;
    let prefix = "";
    parts.forEach((part, index) => {
      prefix = prefix ? `${prefix}/${part}` : part;
      const leaf = index === parts.length - 1;
      let node = children.get(part);
      if (!node) {
        node = {
          name: part,
          path: prefix,
          branch: leaf ? branch : undefined,
          children: new Map(),
        };
        children.set(part, node);
      }
      if (leaf) node.branch = branch;
      else children = node.children;
    });
  }
  const finish = (children: Map<string, MutableNode>): BranchTreeNode[] =>
    [...children.values()]
      .sort((a, b) =>
        !a.branch && b.branch
          ? -1
          : a.branch && !b.branch
            ? 1
            : a.name.localeCompare(b.name),
      )
      .map((node) => ({
        name: node.name,
        path: node.path,
        branch: node.branch,
        children: finish(node.children),
      }));
  return finish(root);
}

function BranchTreeView({
  branches,
  prefix,
  search,
  collapsed,
  setCollapsed,
  onSwitch,
  busy,
}: {
  branches: Branch[];
  prefix: string;
  search: string;
  collapsed: Set<string>;
  setCollapsed: (value: (old: Set<string>) => Set<string>) => void;
  onSwitch: (name: string) => void;
  busy: boolean;
}) {
  const filtered = useMemo(
    () =>
      branches.filter((branch) =>
        branch.name.toLowerCase().includes(search.toLowerCase()),
      ),
    [branches, search],
  );
  const tree = useMemo(() => buildBranchTree(filtered), [filtered]);
  const render = (nodes: BranchTreeNode[], depth: number): ReactNode[] =>
    nodes.flatMap((node) => {
      const key = `${prefix}:${node.path}`;
      if (node.branch) {
        const branch = node.branch;
        return [
          <button
            type="button"
            key={`leaf:${key}`}
            className={`branch-leaf${branch.current ? " current" : ""}`}
            style={{ paddingLeft: 12 + depth * 15 }}
            title={branch.name}
            disabled={busy || branch.current}
            onClick={() => onSwitch(branch.name)}
          >
            <GitBranch size={13} />
            <span>{node.name}</span>
            {branch.current && <Check size={13} />}
          </button>,
        ];
      }
      const expanded = !!search || !collapsed.has(key);
      return [
        <button
          type="button"
          key={`folder:${key}`}
          className="branch-folder"
          style={{ paddingLeft: 10 + depth * 15 }}
          aria-expanded={expanded}
          onClick={() =>
            setCollapsed((old) => {
              const next = new Set(old);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            })
          }
        >
          {expanded ? (
            <ChevronDown size={13} />
          ) : (
            <ChevronRight size={13} />
          )}
          {expanded ? <FolderOpen size={13} /> : <Folder size={13} />}
          <span>{node.name}</span>
        </button>,
        ...(expanded ? render(node.children, depth + 1) : []),
      ];
    });
  return <div className="branch-tree">{render(tree, 0)}</div>;
}

function buildFileTree(
  files: FileStatus[],
  rootNode?: { name: string; path: string },
): FileTreeNode[] {
  type MutableNode = {
    name: string;
    path: string;
    isDir: boolean;
    file?: FileStatus;
    children: Map<string, MutableNode>;
  };
  const root = new Map<string, MutableNode>();
  for (const file of files) {
    const parts = file.path.split("/");
    let children = root;
    let prefix = "";
    parts.forEach((part, index) => {
      prefix = prefix ? `${prefix}/${part}` : part;
      const leaf = index === parts.length - 1;
      let node = children.get(part);
      if (!node) {
        node = {
          name: part,
          path: prefix,
          isDir: !leaf,
          file: leaf ? file : undefined,
          children: new Map(),
        };
        children.set(part, node);
      }
      if (leaf) {
        node.isDir = false;
        node.file = file;
      } else {
        node.isDir = true;
        children = node.children;
      }
    });
  }
  const finish = (children: Map<string, MutableNode>): FileTreeNode[] =>
    [...children.values()]
      .sort((a, b) =>
        a.isDir === b.isDir
          ? a.name.localeCompare(b.name)
          : a.isDir
            ? -1
            : 1,
      )
      .map((node) => ({
        name: node.name,
        path: node.path,
        isDir: node.isDir,
        file: node.file,
        children: finish(node.children),
      }));
  const children = finish(root);
  if (rootNode) {
    return [
      {
        name: rootNode.name,
        path: rootNode.path,
        isDir: true,
        children,
      },
    ];
  }
  return children;
}

function fileStats(file: FileStatus) {
  return {
    additions:
      (file.indexAdditions || 0) + (file.worktreeAdditions || 0),
    deletions:
      (file.indexDeletions || 0) + (file.worktreeDeletions || 0),
  };
}

function flattenTree(node: FileTreeNode): FileStatus[] {
  if (node.file) return [node.file];
  return node.children.flatMap(flattenTree);
}

function treeStats(node: FileTreeNode) {
  return flattenTree(node).reduce(
    (total, file) => {
      const stats = fileStats(file);
      return {
        additions: total.additions + stats.additions,
        deletions: total.deletions + stats.deletions,
      };
    },
    { additions: 0, deletions: 0 },
  );
}

function hasStaged(f: FileStatus) {
  return f.index !== " " && f.index !== "?";
}
function RelativeTime({ date }: { date: string }) {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return <>{date}</>;
  const seconds = Math.max(0, Math.floor((Date.now() - value.getTime()) / 1000));
  if (seconds < 60) return <>刚刚</>;
  if (seconds < 3600) return <>{Math.floor(seconds / 60)} 分钟前</>;
  if (seconds < 86400) return <>{Math.floor(seconds / 3600)} 小时前</>;
  if (seconds < 7 * 86400) return <>{Math.floor(seconds / 86400)} 天前</>;
  return <>{value.toLocaleDateString("zh-CN")}</>;
}
function hasUnstaged(f: FileStatus) {
  return f.worktree !== " " || f.index === "?";
}
function diffStats(text: string) {
  let files = 0,
    insertions = 0,
    deletions = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) files++;
    else if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    else if (line.startsWith("+")) insertions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { files, insertions, deletions };
}

function diffChangeKind(diff: string) {
  if (/^new file mode /m.test(diff) || /^--- \/dev\/null$/m.test(diff))
    return "added";
  if (/^deleted file mode /m.test(diff) || /^\+\+\+ \/dev\/null$/m.test(diff))
    return "deleted";
  if (/^rename (?:from|to) /m.test(diff)) return "renamed";
  return "modified";
}

export function DiffViewer({
  text,
  showFileHeaders = true,
  stats,
  fileCount,
  ignored = 0,
}: {
  text: string;
  showFileHeaders?: boolean;
  stats?: { additions: number; deletions: number };
  fileCount?: number;
  ignored?: number;
}) {
  const [limit, setLimit] = useState(1500);
  const filteredStats = useMemo(() => diffStats(text), [text]);
  const shownStats = stats ?? {
    additions: filteredStats.insertions,
    deletions: filteredStats.deletions,
  };
  const lines = useMemo(() => {
    let old = 0,
      next = 0;
    let insideHunk = false;
    return text.split("\n").flatMap((line, index) => {
      const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
      if (hunk) {
        insideHunk = true;
        old = Number(hunk[1]);
        next = Number(hunk[2]);
        return [{ line, index, type: "hunk", old: "", next: "" }];
      }
      if (line.startsWith("diff --git ")) {
        insideHunk = false;
        return showFileHeaders
          ? [{ line: line.slice(11), index, type: "file", old: "", next: "" }]
          : [];
      }
      if (
        line.startsWith("index ") ||
        line.startsWith("--- ") ||
        line.startsWith("+++ ")
      )
        return [];
      if (line.startsWith("new file") || line.startsWith("deleted file"))
        return [{ line, index, type: "meta", old: "", next: "" }];
      if (line.startsWith("+"))
        return [{ line, index, type: "add", old: "", next: String(next++) }];
      if (line.startsWith("-"))
        return [{ line, index, type: "delete", old: String(old++), next: "" }];
      if (line.startsWith(" ") && insideHunk)
        return [
          {
            line,
            index,
            type: "context",
            old: String(old++),
            next: String(next++),
          },
        ];
      return line ? [{ line, index, type: "meta", old: "", next: "" }] : [];
    });
  }, [text, showFileHeaders]);
  return (
    <div className="desktop-diff" role="region" aria-label="文件差异">
      <div className="diff-summary" aria-label="差异统计">
        <span>{fileCount ?? filteredStats.files} 个文件</span>
        <span className="stat-add">+{shownStats.additions}</span>
        <span className="stat-del">−{shownStats.deletions}</span>
        {ignored > 0 && (
          <span className="diff-ignored">已忽略 {ignored} 行换行符差异</span>
        )}
      </div>
      <div className="diff-table">
        {lines.slice(0, limit).map((row) => (
          <div className={`diff-line ${row.type}`} key={row.index}>
            <span className="line-number">{row.old}</span>
            <span className="line-number">{row.next}</span>
            <code>{row.line || " "}</code>
          </div>
        ))}
      </div>
      {lines.length > limit && (
        <div className="diff-more">
          已显示 {limit} / {lines.length} 行。
          <button onClick={() => setLimit((n) => n + 1500)}>继续显示</button>
        </div>
      )}
    </div>
  );
}







