import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
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
export default function Desktop() {
  const client = useQueryClient(),
    ui = useUI();
  const [popup, setPopup] = useState<Popup>(""),
    [panel, setPanel] = useState<Panel>("");
  const customTitlebar = isDesktop && navigator.userAgent.includes("Windows");
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
    return () => media?.removeEventListener("change", apply);
  }, [theme]);
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
    status.data?.behind && !status.data.ahead
      ? "pull"
      : status.data?.ahead && !status.data.behind
        ? "push"
        : "fetch";
  const menuItems: Record<
    string,
    { label: string; action: () => void; disabled?: boolean }[]
  > = {
    file: [
      { label: "添加本地仓库…", action: () => show("import") },
      { label: "管理本地目录…", action: () => show("local-management") },
      {
        label: "克隆仓库…",
        action: () => { setCloneRequest(undefined); show("clone-url"); },
      },
      { label: "设置…", action: () => show("settings") },
    ],
    edit: [
      {
        label: "在编辑器中打开",
        disabled: !checkout,
        action: () =>
          void execute(() => api("OpenCheckout", checkout!.id, "editor")),
      },
      {
        label: "复制本地路径",
        disabled: !checkout,
        action: () =>
          void execute(() => navigator.clipboard.writeText(checkout!.path)),
      },
    ],
    view: [
      {
        label: "变更",
        action: () => {
          setTab("changes");
          setPopup("");
        },
      },
      {
        label: "历史",
        action: () => {
          setTab("history");
          setPopup("");
        },
      },
      {
        label: "刷新仓库状态",
        disabled: !checkout,
        action: () => {
          void status.refetch();
          setPopup("");
        },
      },
      {
        label: "任务中心",
        action: () => {
          ui.set({ tasksOpen: true });
          setPopup("");
        },
      },
      { label: `跟随系统主题${theme === "system" ? "（当前）" : ""}`, action: () => setTheme("system") },
      { label: `日间主题${theme === "light" ? "（当前）" : ""}`, action: () => setTheme("light") },
      { label: `暗黑主题${theme === "dark" ? "（当前）" : ""}`, action: () => setTheme("dark") },
    ],
    repository: [
      {
        label: "在文件夹中打开",
        disabled: !checkout,
        action: () =>
          void execute(() => api("OpenCheckout", checkout!.id, "folder")),
      },
      {
        label: "在 GitHub 中查看",
        disabled: !selected?.repository,
        action: () => void execute(() => api("OpenRepository", selected!.id)),
      },
      {
        label: "分享到 GitHub…",
        disabled:
          !checkout ||
          !!checkout.plainDirectory ||
          !st.accounts.length ||
          remotes.some((r) => /github\.com/i.test(r.url)),
        action: () => show("share"),
      },
      {
        label: "仓库设置…",
        disabled: !checkout,
        action: () => show("repository"),
      },
      {
        label: selected?.favorite ? "取消收藏" : "收藏仓库",
        disabled: !selected,
        action: () => void execute(() => api("ToggleFavorite", selected!.id)),
      },
    ],
    help: [
      { label: "账号与身份…", action: () => show("accounts") },
      { label: "关于 Repo Berth", action: () => show("about") },
    ],
  };
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
    <div className={`desktop-shell${customTitlebar ? " custom-titlebar" : ""}`}>
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
                  {menuItems[id]?.map((item) => (
                    <button
                      key={item.label}
                      disabled={item.disabled}
                      onClick={() => {
                        setPopup("");
                        item.action();
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
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
              <FolderGit2 size={20} />
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
              <strong>
                {action === "fetch"
                  ? "Fetch"
                  : action === "pull"
                    ? "Pull"
                    : "Push"}{" "}
                {remote || "remote"}{" "}
                {action === "push" && status.data?.ahead
                  ? `↑${status.data.ahead}`
                  : ""}
              </strong>
              <small>
                {busy
                  ? "正在处理仓库任务…"
                  : lastFetched[checkout?.id || ""]
                    ? `上次获取 ${new Date(lastFetched[checkout!.id]).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
                    : checkout
                      ? "获取远程更新"
                      : "请选择本地仓库"}
              </small>
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
                    ? "Fetch · 获取远程更新"
                    : op === "pull"
                      ? "Pull · 仅快进拉取"
                      : "Push · 推送当前分支"}
                </button>
              ))}
              <p>访问账号：{account?.login || "尚未绑定"}</p>
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
                      {c.plainDirectory ? (
                        <FolderOpen size={16} />
                      ) : (
                        <FolderGit2 size={16} />
                      )}
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
                    <FolderGit2 size={16} />
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
    [selected, setSelected] = useState<{ path: string; staged: boolean }>(),
    [commitHash, setCommitHash] = useState(""),
    [historyFile, setHistoryFile] = useState(""),
    [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set()),
    [sending, setSending] = useState(false),
    [stageOverrides, setStageOverrides] = useState<Record<string, boolean>>({}),
    [stagingPaths, setStagingPaths] = useState<Set<string>>(new Set()),
    [stageError, setStageError] = useState("");
  const draft = useUI((s) => s.commitDrafts[c.id] || ""),
    submission = useUI((s) => s.commitSubmissions[c.id]);
  const split = draft.indexOf("\n");
  const summary = split < 0 ? draft : draft.slice(0, split);
  const description =
    split < 0 ? "" : draft.slice(split + 1).replace(/^\n/, "");
  const writeDraft = (title: string, body: string) =>
    useUI.getState().setCommitDraft(c.id, title + (body ? "\n\n" + body : ""));
  const files = status?.files || [];
  const staged = files.filter(hasStaged);
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
  const filtered = files.filter((f) =>
    f.path.toLowerCase().includes(filter.toLowerCase()),
  );
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
    const chunks = (commitDiff.data || "").split(/(?=^diff --git )/m).filter((chunk) => chunk.startsWith("diff --git "));
    return chunks.map((diff) => ({
      path: (() => {
        const header = /^diff --git (?:"a\/.*" "b\/([^"]+)"|a\/.* b\/(.*))$/m.exec(diff);
        return header?.[1] || header?.[2] || "未知文件";
      })(),
      diff,
    })).sort((a, b) => a.path.localeCompare(b.path));
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
            <label className="file-filter">
              <Search size={14} />
              <input
                aria-label="筛选变更文件"
                placeholder="筛选文件…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </label>
            <div className="file-count">
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
              <span>
                {status ? `${files.length} 个变更文件` : "正在读取变更…"}
              </span>
            </div>
            {stageError && <div className="desktop-stage-error" role="alert">{stageError}</div>}
            <div className="desktop-file-list">
              {filtered.map((f) => (
                <div
                  className={`desktop-file-row ${file?.path === f.path ? "selected" : ""}`}
                  key={f.path}
                >
                  <label className="file-stage-toggle" title={fullyStaged(f) ? `取消暂存 ${f.path}` : `暂存 ${f.path}`}><input
                    aria-label={`${fullyStaged(f) ? "取消暂存" : "暂存"} ${f.path}`}
                    type="checkbox"
                    checked={fullyStaged(f)}
                    disabled={busy || !!statusError || !status || stagingPaths.has(f.path)}
                    onChange={() => stage(f)}
                  /></label>
                  <button
                    title={f.path}
                    className="file-name"
                    onClick={() =>
                      setSelected({
                        path: f.path,
                        staged: hasStaged(f) && !hasUnstaged(f),
                      })
                    }
                  >
                    <FileText size={14} />
                    <span>
                      {f.originalPath ? `${f.originalPath} → ` : ""}
                      {f.path}
                    </span>
                    <code
                      className={
                        f.index === "?" || f.index === "A"
                          ? "added"
                          : f.index === "D" || f.worktree === "D"
                            ? "removed"
                            : ""
                      }
                    >
                      {f.index === "?"
                        ? "+"
                        : f.worktree.trim() || f.index.trim()}
                    </code>
                  </button>
                </div>
              ))}
              {!filtered.length && !!files.length && (
                <p className="desktop-list-empty">没有匹配的文件</p>
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
                    {historyFiles.flatMap(({ path }, index) => {
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
                      return [...folderRows, ...(visible ? [<button key={`file:${path}`} className={historyFile === path ? "selected" : ""} style={{ paddingLeft: 10 + folders.length * 13 }} title={path} onClick={() => setHistoryFile(path)}>
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
    </div>
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
export function DiffViewer({
  text,
  showFileHeaders = true,
}: {
  text: string;
  showFileHeaders?: boolean;
}) {
  const [limit, setLimit] = useState(1500);
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
