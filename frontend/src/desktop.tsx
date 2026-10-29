import { useEffect, useMemo, useRef, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
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
  Save,
} from "lucide-react";
import { version } from "../package.json";
import { api, errorMessage, isDesktop, onStateChanged } from "./api";
import {
  emptyState,
  type State,
  type Checkout,
  type FileStatus,
  type GitStatus,
  type Task,
} from "./types";
import { rowsFromState, filterRows, type Execute, type Row } from "./catalog";
import { useUI } from "./ui";
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
    [remoteChoices, setRemoteChoices] = useState<Record<string, string>>({});
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
    [newBranch, setNewBranch] = useState("");
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
        label: "在文件夹中打开",
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
          {branches.data
            ?.filter((b) =>
              b.name.toLowerCase().includes(branchSearch.toLowerCase()),
            )
            .map((b) => (
              <button
                disabled={busy || b.current}
                key={b.name}
                onClick={() =>
                  void execute(async () => {
                    await api("SwitchBranch", checkout!.id, b.name, false);
                    setPopup("");
                  })
                }
              >
                <GitBranch size={15} />
                {b.name}
                {b.current && <Check size={15} />}
              </button>
            ))}
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
        <img src="/app-icon.svg" alt="" width="17" height="17" />
        <span className="desktop-app-name">Repo Berth</span>
        {[
          ["file", "文件"],
          ["edit", "编辑"],
          ["view", "视图"],
          ["repository", "仓库"],
          ["branch", "分支"],
          ["help", "帮助"],
        ].map(([id, label]) => (
          <div data-desktop-popup key={id} onMouseEnter={() => {
            if (["file", "edit", "view", "repository", "branch", "help"].includes(popup)) setPopup(id as Popup);
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
              </span>
              {busy ? (
                <small>执行中…</small>
              ) : lastFetch ? (
                <small>
                  上次获取{" "}
                  {new Date(lastFetch).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </small>
              ) : null}
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
        <span>
          {version}
          {!isDesktop
            ? " · 浏览器预览"
            : environment.isError
              ? " · Git 不可用"
              : environment.data
                ? " · Git 已就绪"
                : " · 正在检测 Git"}
        </span>
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
            <img src="/app-icon.svg" width="64" height="64" alt="" />
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
    [newFileError, setNewFileError] = useState("");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLPreElement>(null);
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
  const tree = useMemo(() => buildFileTree(filtered), [filtered]);
  const confirmDiscard = () =>
    !editing ||
    editorText === editorOriginal ||
    window.confirm("未保存的修改将丢失，继续？");
  const selectFile = (f: FileStatus) => {
    if (!confirmDiscard()) return;
    setEditing("");
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
      const target = files.find((item) => item.path === path);
      if (target)
        setSelected({
          path,
          staged: hasStaged(target) && !hasUnstaged(target),
        });
    } catch (e) {
      setEditorText("");
      setEditorOriginal("");
      setEditing(path);
      setEditorError(errorMessage(e));
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
  const createFile = async () => {
    const name = newFileName.trim().replace(/^\/+/, "");
    if (!name) return;
    setNewFileError("");
    try {
      await api("CreateWorkingFile", c.id, name);
      setNewFileOpen(false);
      setNewFileName("");
      await client.invalidateQueries({ queryKey: ["git", "status", c.id] });
      await client.invalidateQueries({ queryKey: ["git", "files", c.id] });
      await openEditor(name);
    } catch (e) {
      setNewFileError(errorMessage(e));
    }
  };
  const openMenu = (event: ReactMouseEvent, node: FileTreeNode) => {
    event.preventDefault();
    event.stopPropagation();
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
            className="tree-folder"
            key={`folder:${node.path}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() =>
              setChangesCollapsed((old) => {
                const next = new Set(old);
                if (next.has(node.path)) next.delete(node.path);
                else next.add(node.path);
                return next;
              })
            }
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
          className={`desktop-file-row tree-file ${file?.path === item.path ? "selected" : ""}`}
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
                void openEditor(item.path);
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
  const diff = useQuery({
    queryKey: ["git", "diff", c.id, activeFile?.path, activeFile?.staged],
    queryFn: () => api("GitDiff", c.id, activeFile!.path, activeFile!.staged),
    enabled: tab === "changes" && !!activeFile,
  });
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
  const editable = (f?: FileStatus) =>
    !!f && f.worktree !== "D" && f.index !== "D";
  return (
    <div
      className={`desktop-workspace ${activeFile || commit ? "has-file" : ""} ${tab === "changes" && status && files.length === 0 ? "clean-state" : ""}`}
    >
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
                onClick={() => {
                  setNewFileName("");
                  setNewFileError("");
                  setNewFileOpen(true);
                }}
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
              history.data.map((item) => (
                <button
                  className={commit?.hash === item.hash ? "selected" : ""}
                  key={item.hash}
                  onClick={() => { setCommitHash(item.hash); setHistoryFile(""); setCollapsedFolders(new Set()); }}
                >
                  <GitCommitHorizontal size={16} />
                  <span>
                    <strong>{item.subject}</strong>
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
              ))
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
              {commitDiff.isPending ? (
                <Loading />
              ) : commitDiff.isError ? (
                <ErrorNotice message={errorMessage(commitDiff.error)} />
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
                  <DiffViewer key={commit.hash + historyFile} text={historyFile ? historyFiles.find((f) => f.path === historyFile)?.diff || "" : commitDiff.data || ""} />
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
                <textarea
                  ref={editorRef}
                  aria-label={`编辑 ${editing}`}
                  value={editorText}
                  spellCheck={false}
                  onChange={(e) => {
                    setEditorText(e.target.value);
                    updateCursorLine();
                  }}
                  onScroll={(e) => {
                    if (gutterRef.current)
                      gutterRef.current.scrollTop = e.currentTarget.scrollTop;
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
            )}
          </div>
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
            ) : diff.data ? (
              <DiffViewer
                key={activeFile.path + activeFile.staged}
                text={diff.data}
                showFileHeaders={false}
              />
            ) : (
              <div className="desktop-empty-detail">
                <FileText size={32} />
                <h2>暂无文本差异</h2>
                <p>
                  {file?.index === "?"
                    ? "新文件尚未跟踪。勾选文件加入暂存后可查看差异。"
                    : "此变更可能是二进制文件、重命名或文件属性变化。"}
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
      {menu && (
        <div
          className="desktop-context-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
        >
          {menu.node.path === "" ? (
            <button
              onClick={() => {
                setMenu(undefined);
                setNewFileName("");
                setNewFileError("");
                setNewFileOpen(true);
              }}
            >
              <FilePlus2 size={14} />
              新建文件…
            </button>
          ) : menu.node.isDir ? (
            <>
              {flattenTree(menu.node).some(isChanged) && (
                <button
                  onClick={() =>
                    stageNode(menu.node, !nodeStaged(menu.node))
                  }
                >
                  {nodeStaged(menu.node) ? "取消暂存目录" : "暂存目录"}
                </button>
              )}
              <button
                onClick={() => {
                  setMenu(undefined);
                  setNewFileName(`${menu.node.path}/`);
                  setNewFileError("");
                  setNewFileOpen(true);
                }}
              >
                <FilePlus2 size={14} />
                新建文件…
              </button>
              <button onClick={() => ignoreNode(menu.node)}>
                <EyeOff size={14} />
                添加到 .gitignore
              </button>
              {flattenTree(menu.node).some(
                (file) => file.tracked ?? file.index !== "?",
              ) && (
                <button onClick={() => untrackNode(menu.node)}>
                  <Trash2 size={14} />
                  移除 Git 跟踪
                </button>
              )}
            </>
          ) : (
            <>
              {isChanged(menu.node.file!) && (
                <button
                  onClick={() =>
                    stageNode(menu.node, !nodeStaged(menu.node))
                  }
                >
                  {nodeStaged(menu.node) ? "取消暂存" : "暂存"}
                </button>
              )}
              <button
                disabled={!editable(menu.node.file)}
                onClick={() => void openEditor(menu.node.path)}
              >
                <Pencil size={14} />
                编辑文件
              </button>
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
                复制路径
              </button>
            </>
          )}
        </div>
      )}
      {newFileOpen && (
        <Modal title="新建文件" onClose={() => setNewFileOpen(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void createFile();
            }}
          >
            <Field label="文件路径" hint="相对仓库根目录，例如 src/new.ts">
              <input
                autoFocus
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                placeholder="src/new.ts"
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

function buildFileTree(files: FileStatus[]): FileTreeNode[] {
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
  return finish(root);
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
}: {
  text: string;
  showFileHeaders?: boolean;
}) {
  const [limit, setLimit] = useState(1500);
  const stats = useMemo(() => diffStats(text), [text]);
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
        <span>{stats.files} 个文件</span>
        <span className="stat-add">+{stats.insertions}</span>
        <span className="stat-del">−{stats.deletions}</span>
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
