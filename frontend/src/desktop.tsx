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
  Columns2,
  Clock3,
  Star,
  Activity,
  FileText,
  ArrowLeft,
  Minus,
  Square,
  Github,
  Folder,
  Files,
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
  WrapText,
  Save,
  Download,
  Info,
  Palette,
  Share2,
  Sun,
  Moon,
  Monitor,
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
  ActionRow,
} from "./components";
import { DiffViewer, SplitDiffView, diffStats, diffChangeKind } from "./diff-view";
import { BranchTreeView } from "./branch-tree";
import { commitPills } from "./commit-labels";
import {
  BinaryDiffPane,
  CommitMediaPreview,
  FilePreviewPane,
  FileStatusBar,
} from "./file-preview";
import {
  absoluteWorkingPath,
  buildFileTree,
  fileStats,
  findTreeNode,
  flattenTree,
  hasStaged,
  hasUnstaged,
  parentPath,
  treeStats,
  type FileTreeNode,
} from "./file-tree";
export { DiffViewer } from "./diff-view";
import { ScopePicker } from "./scope-picker";
import { AccountsView, SettingsView } from "./settings";
import { Worktree } from "./worktree";
import { NoticesView } from "./notices";
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
  | "about"
  | "notices";
type MenuNode = {
  label: string;
  action?: () => void;
  disabled?: boolean;
  hidden?: boolean;
  checked?: boolean;
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
  const [wordWrap, setWordWrap] = useState(
    () => localStorage.getItem("repo-berth-wrap") === "true",
  );
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
    localStorage.setItem("repo-berth-wrap", String(wordWrap));
  }, [wordWrap]);
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
        label: "自动换行",
        nativeAction: "view.wrap",
        checked: wordWrap,
        action: () => {
          setWordWrap((value) => !value);
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
  const menuIcons: Record<string, ReactNode> = {
    "file.import": <FolderPlus size={14} />,
    "file.manage-local": <FolderGit2 size={14} />,
    "file.clone": <Download size={14} />,
    "app.settings": <Settings2 size={14} />,
    "edit.open-editor": <Code2 size={14} />,
    "edit.copy-path": <Copy size={14} />,
    "view.changes": <FileText size={14} />,
    "view.history": <Clock3 size={14} />,
    "view.refresh": <RefreshCw size={14} />,
    "view.wrap": <WrapText size={14} />,
    "view.tasks": <Activity size={14} />,
    "view.theme.system": <Monitor size={14} />,
    "view.theme.light": <Sun size={14} />,
    "view.theme.dark": <Moon size={14} />,
    "repository.open-vscode": <Code2 size={14} />,
    "repository.open-folder": <FolderOpen size={14} />,
    "repository.open-github": <Github size={14} />,
    "repository.share": <Share2 size={14} />,
    "repository.settings": <Settings2 size={14} />,
    "repository.favorite": <Star size={14} />,
    "branch.switch": <GitBranch size={14} />,
    "update.check": <RefreshCw size={14} />,
    "help.accounts": <UsersRound size={14} />,
    "help.about": <Info size={14} />,
  };
  const menuIcon = (nativeAction?: string) =>
    nativeAction ? menuIcons[nativeAction] : undefined;
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
                          <span className="menu-item-label">
                            {menuIcon(item.nativeAction)}
                            {item.label}
                          </span>
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
                              <span className="menu-item-label">
                                {menuIcon(child.nativeAction)}
                                {child.label}
                              </span>
                              {child.checked && <Check size={14} />}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <button
                        key={item.label}
                        className={item.checked ? "checked" : ""}
                        disabled={item.disabled}
                        onClick={() => {
                          setPopup("");
                          item.action?.();
                        }}
                      >
                        <span className="menu-item-label">
                          {menuIcon(item.nativeAction)}
                          {item.label}
                        </span>
                        {item.checked && <Check size={14} />}
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
          wordWrap={wordWrap}
          setWordWrap={setWordWrap}
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
            <div className="form-actions">
              <button onClick={() => show("notices")}>第三方许可</button>
            </div>
          </div>
        </Modal>
      )}
      {panel === "notices" && (
        <Modal title="第三方许可" onClose={closePanel}>
          <NoticesView />
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
