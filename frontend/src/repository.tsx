import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Star,
  ExternalLink,
  FolderOpen,
  Terminal,
  Code2,
  GitBranch,
  GitCommitHorizontal,
  ChevronRight,
  Link2,
  Download,
  Plus,
  Check,
  RefreshCw,
  FolderGit2,
  Upload,
  Github,
} from "lucide-react";
import { api, errorMessage } from "./api";
import { useUI } from "./ui";
import type {
  State,
  Repository,
  Checkout,
  GitStatus,
  FileStatus,
  Task,
} from "./types";
import type { Execute, Row } from "./App";
import {
  DirectoryField,
  ErrorNotice,
  Field,
  Loading,
  Modal,
} from "./components";

export function CloneForm({
  repository: r,
  st,
  execute,
  onDone,
  initial,
  preferredAccountID,
}: {
  repository: Repository;
  st: State;
  execute: Execute;
  onDone: () => void;
  initial?: Task["cloneRequest"];
  preferredAccountID?: string;
}) {
  const accounts = st.accounts.filter((a) =>
    st.access.some((x) => x.accountId === a.id && x.repositoryId === r.id),
  );
  const destination = initial?.destination || "";
  const separator = Math.max(
    destination.lastIndexOf("/"),
    destination.lastIndexOf("\\"),
  );
  const [accountID, setAccountID] = useState(
    initial?.accountId ??
      preferredAccountID ??
      (accounts.some((a) => a.id === st.settings.defaultAccountId)
        ? st.settings.defaultAccountId
        : undefined) ??
      accounts[0]?.id ??
      "",
  );
  const [parent, setParent] = useState(
    destination
      ? destination.slice(0, separator) || "/"
      : st.settings.cloneDirectory,
  );
  const [folder, setFolder] = useState(
    destination ? destination.slice(separator + 1) : r.name,
  );
  const [busy, setBusy] = useState(false);
  const profile = st.profiles.find((p) => p.accountId === accountID);
  const account = accounts.find((a) => a.id === accountID);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void execute(async () => {
          setBusy(true);
          try {
            await api(
              "CloneRepository",
              r.id,
              accountID,
              profile?.id || "",
              `${parent.replace(/[\\/]$/, "")}/${folder}`,
            );
            onDone();
          } finally {
            setBusy(false);
          }
        });
      }}
    >
      <p className="clone-repository">
        <FolderGit2 size={19} />
        {r.owner} / <strong>{r.name}</strong>
      </p>
      {initial && (
        <p className="empty-note">
          已恢复上次克隆的账号和目标目录。将使用该账号当前的提交信息；请确认后重新开始，不会覆盖已有目录。
        </p>
      )}
      {!initial && preferredAccountID && !account && (
        <p className="subtle-note">
          当前筛选的账号尚无此仓库的访问记录。请先同步仓库，或明确选择其他账号。
        </p>
      )}
      <Field label="访问账号">
        <select
          value={account?.id || ""}
          onChange={(e) => {
            setAccountID(e.target.value);
          }}
        >
          <option value="" disabled>
            请选择仍可访问此仓库的账号
          </option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.login}
            </option>
          ))}
        </select>
      </Field>
      {account && <p className="subtle-note">提交信息：{profile ? `${profile.name} <${profile.email}>` : "请先在账号与身份中设置"}</p>}
      <DirectoryField label="克隆父目录" value={parent} onChange={setParent} />
      <Field label="新建目录名称">
        <input
          required
          value={folder}
          pattern={"[^/\\\\]+"}
          onChange={(e) => setFolder(e.target.value)}
        />
      </Field>
      <div className="form-actions">
        <button
          className="primary"
          disabled={busy || !profile || !parent || !folder || !account}
        >
          <Download size={16} />
          开始克隆
        </button>
      </div>
    </form>
  );
}

export function CloneURLForm({
  st, execute, onDone, initial, preferredAccountID,
}: {
  st: State;
  execute: Execute;
  onDone: () => void;
  initial?: Task["cloneRequest"];
  preferredAccountID?: string;
}) {
  const destination = initial?.destination || "";
  const separator = Math.max(destination.lastIndexOf("/"), destination.lastIndexOf("\\"));
  const [url, setURL] = useState(initial?.url || "");
  const [accountID, setAccountID] = useState(initial?.accountId ?? preferredAccountID ?? "");
  const [parent, setParent] = useState(destination ? destination.slice(0, separator) || "/" : st.settings.cloneDirectory);
  const [folder, setFolder] = useState(destination ? destination.slice(separator + 1) : "");
  const [busy, setBusy] = useState(false);
  const profile = st.profiles.find((p) => p.accountId === accountID);
  const validURL = /^https:\/\/github\.com\/[^/\s?#]+\/[^/\s?#]+(?:\.git)?\/?$/i.test(url.trim());
  return <form onSubmit={(e) => {
    e.preventDefault();
    void execute(async () => {
      setBusy(true);
      try {
        await api("CloneFromURL", url.trim(), accountID, profile?.id || "", `${parent.replace(/[\\/]$/, "")}/${folder.trim()}`);
        onDone();
      } finally { setBusy(false); }
    });
  }}>
    <p className="subtle-note">公开仓库可直接克隆；私有仓库请选择有权限的 GitHub 账号。</p>
    {initial && <p className="empty-note">已恢复上次的账号和目标目录。将使用该账号当前的提交信息，请确认后重试。</p>}
    <Field label="仓库地址"><input required autoFocus type="url" value={url} placeholder="https://github.com/owner/repository.git" onChange={(e) => {
      const value = e.target.value;
      setURL(value);
      const name = value.trim().split("/").filter(Boolean).at(-1)?.replace(/\.git$/i, "") || "";
      if (!initial) setFolder(name);
    }} /></Field>
    <Field label="访问账号"><select value={accountID} onChange={(e) => setAccountID(e.target.value)}>
      <option value="">不使用账号（公开仓库）</option>
      {st.accounts.map((a) => <option key={a.id} value={a.id}>{a.login}</option>)}
    </select></Field>
    {accountID && <p className="subtle-note">提交信息：{profile ? `${profile.name} <${profile.email}>` : "请先在账号与身份中设置"}</p>}
    <DirectoryField label="克隆父目录" value={parent} onChange={setParent} />
    <Field label="新建目录名称"><input required pattern="[^/\\]+" value={folder} onChange={(e) => setFolder(e.target.value)} /></Field>
    <div className="form-actions"><button className="primary" disabled={busy || !validURL || (!!accountID && !profile) || !parent || !folder.trim()}>克隆仓库</button></div>
  </form>;
}
export function ShareForm({
  checkout,
  st,
  execute,
  onDone,
}: {
  checkout: Checkout;
  st: State;
  execute: Execute;
  onDone: () => void;
}) {
  const withProfile = st.accounts.filter((a) =>
    st.profiles.some((p) => p.accountId === a.id),
  );
  const [accountID, setAccountID] = useState(
    withProfile.find((a) => a.id === st.settings.defaultAccountId)?.id ||
      withProfile[0]?.id ||
      "",
  );
  const [name, setName] = useState(checkout.name);
  const [description, setDescription] = useState("");
  const [isPrivate, setPrivate] = useState(true);
  const [busy, setBusy] = useState(false);
  const profile = st.profiles.find((p) => p.accountId === accountID);
  const trimmed = name.trim();
  const validName =
    /^[A-Za-z0-9._-]{1,100}$/.test(trimmed) &&
    trimmed !== "." &&
    trimmed !== "..";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void execute(async () => {
          setBusy(true);
          try {
            await api(
              "ShareRepository",
              checkout.id,
              accountID,
              trimmed,
              description.trim(),
              isPrivate,
            );
            onDone();
          } finally {
            setBusy(false);
          }
        });
      }}
    >
      <p className="clone-repository">
        <Github size={19} />
        {checkout.name} <Upload size={15} /> GitHub
      </p>
      <p className="subtle-note">
        将在所选账号下创建新仓库，把当前目录添加为 origin 并推送当前分支。
      </p>
      {!withProfile.length ? (
        <p className="empty-note">
          请先在“账号与身份”中为 GitHub 账号设置提交姓名和邮箱。
        </p>
      ) : (
        <Field label="发布到账号">
          <select
            value={accountID}
            onChange={(e) => setAccountID(e.target.value)}
          >
            {withProfile.map((a) => (
              <option key={a.id} value={a.id}>
                {a.login}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="仓库名称">
        <input
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-project"
        />
      </Field>
      {!validName && trimmed && (
        <p className="empty-note">
          名称只能包含字母、数字、点、下划线和连字符。
        </p>
      )}
      <Field label="仓库描述（可选）">
        <textarea
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="简要说明这个仓库的用途"
        />
      </Field>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={isPrivate}
          onChange={(e) => setPrivate(e.target.checked)}
        />
        私有仓库（仅自己和协作者可见）
      </label>
      {profile && (
        <p className="subtle-note">
          提交信息：{profile.name} &lt;{profile.email}&gt;
        </p>
      )}
      <div className="form-actions">
        <button
          className="primary"
          disabled={
            busy ||
            !accountID ||
            !profile ||
            !validName ||
            description.trim().length > 350
          }
        >
          <Upload size={16} />
          创建并推送
        </button>
      </div>
    </form>
  );
}
export function RepositoryDetail({
  row,
  st,
  execute,
  onClone,
  onBack,
  initialCheckoutID,
  initialRemote,
}: {
  row: Row;
  st: State;
  execute: Execute;
  onClone: () => void;
  onBack: () => void;
  initialCheckoutID?: string;
  initialRemote?: string;
}) {
  const [checkoutID, setCheckoutID] = useState(
    initialCheckoutID || row.checkouts[0]?.id || "",
  );
  const checkout =
    row.checkouts.find((c) => c.id === checkoutID) || row.checkouts[0];
  const [tab, setTab] = useState("overview");
  const [remoteSelections, setRemoteSelections] = useState<
    Record<string, string>
  >({
    [initialCheckoutID || row.checkouts[0]?.id || ""]:
      initialRemote || "origin",
  });
  const remote = remoteSelections[checkout?.id || ""] || "origin";
  const setRemote = (value: string) =>
    setRemoteSelections((values) => ({
      ...values,
      [checkout?.id || ""]: value,
    }));
  const [bindingOpen, setBindingOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [forgetOpen, setForgetOpen] = useState(false);
  const status = useQuery({
    queryKey: ["git", "status", checkout?.id],
    queryFn: () => api("GitStatus", checkout!.id),
    enabled: !!checkout,
    refetchInterval: checkout ? 12000 : false,
  });
  const remotes = status.data?.remotes || checkout?.remotes || [];
  const selectedRemote = remotes.some((r) => r.name === remote) ? remote : "";
  const binding = st.bindings.find(
    (b) => b.checkoutId === checkout?.id && b.remote === selectedRemote,
  );
  const account = st.accounts.find((a) => a.id === binding?.accountId);
  const profile = st.profiles.find((p) => p.id === binding?.profileId);
  const busy = st.tasks.some(
    (t) =>
      t.target === checkout?.id &&
      (t.state === "running" || t.state === "queued"),
  );
  const verifying = status.isPending || status.isFetching || status.isError;
  const networkUnavailable =
    busy ||
    verifying ||
    !account ||
    account.status === "auth_required" ||
    !selectedRemote;
  const network = (op: string) =>
    execute(async () => {
      await api("GitNetwork", checkout!.id, selectedRemote, op);
    });
  return (
    <>
      <div className="detail-header">
        <button className="mobile-only text-button" onClick={onBack}>
          <ArrowLeft size={16} />
          返回仓库
        </button>
        <div className="detail-title">
          <span className="repo-fullname">{row.owner} /</span>
          <div>
            <h2>{row.name}</h2>
            <button
              className={`icon-button ${row.favorite ? "is-favorite" : ""}`}
              aria-label={row.favorite ? "取消收藏" : "收藏仓库"}
              onClick={() => void execute(() => api("ToggleFavorite", row.id))}
            >
              <Star size={18} fill={row.favorite ? "currentColor" : "none"} />
            </button>
            {row.repository && (
              <button
                className="icon-button"
                aria-label="打开 GitHub 仓库"
                onClick={() =>
                  void execute(() => api("OpenRepository", row.id))
                }
              >
                <ExternalLink size={17} />
              </button>
            )}
          </div>
        </div>
        {row.description && <p>{row.description}</p>}
        <div className="detail-tags">
          <span className="pill neutral">
            {row.repository
              ? row.repository.private
                ? "私有仓库"
                : "公开仓库"
              : "本地仓库"}
          </span>
          {row.repository?.language && <span>{row.repository.language}</span>}
          <button className="text-button" onClick={() => setGroupOpen(true)}>
            管理分组
          </button>
        </div>
      </div>
      <div className="detail-tabs" role="tablist" aria-label="仓库内容">
        {[
          { id: "overview", label: "概览" },
          { id: "changes", label: "变更" },
          { id: "branches", label: "分支" },
          { id: "history", label: "历史" },
        ].map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "active" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "changes" &&
              status.data &&
              status.data.files.length > 0 && (
                <span>{status.data.files.length}</span>
              )}
          </button>
        ))}
      </div>
      <div className="detail-content">
        {checkout ? (
          <>
            <div className="checkout-picker">
              <Field label="本地副本">
                <select
                  value={checkout.id}
                  onChange={(e) => setCheckoutID(e.target.value)}
                >
                  {row.checkouts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.path}
                    </option>
                  ))}
                </select>
              </Field>
              <button
                className="icon-button"
                title="刷新仓库状态"
                aria-label="刷新仓库状态"
                onClick={() => void status.refetch()}
              >
                <RefreshCw size={16} />
              </button>
            </div>
            {status.isError && (
              <ErrorNotice message={errorMessage(status.error)} />
            )}
            <div className="binding-strip">
              <div className="binding-strip-top">
                <Link2 size={15} />
                <strong>仓库身份绑定</strong>
                <select
                  aria-label="选择 remote"
                  value={selectedRemote}
                  onChange={(e) => setRemote(e.target.value)}
                >
                  <option value="" disabled>
                    {remotes.length ? "请选择 remote" : "无 remote"}
                  </option>
                  {remotes.map((r) => (
                    <option key={r.name}>{r.name}</option>
                  ))}
                </select>
                <button
                  className="text-button"
                  disabled={verifying || !selectedRemote}
                  onClick={() => setBindingOpen(true)}
                >
                  配置
                </button>
              </div>
              <div className="identity-lanes">
                <div>
                  <small>访问账号</small>
                  <strong>{account?.login || "未绑定"}</strong>
                </div>
                <ChevronRight size={14} />
                <div>
                  <small>提交身份</small>
                  <strong>{profile?.name || "未确认"}</strong>
                  <span>{profile?.email || "请先配置仓库身份"}</span>
                </div>
              </div>
            </div>
            {!verifying && remotes.length > 0 && !selectedRemote && (
              <p className="subtle-note" role="status">
                remote「{remote}」当前不存在。请选择
                remote，并确认访问账号和提交身份。
              </p>
            )}
            {account?.status === "auth_required" ? (
              <p className="subtle-note" role="status">
                账号 {account.login} 需要重新授权。本地文件和提交身份仍保留。{" "}
                <button
                  className="text-button"
                  onClick={() => useUI.getState().set({ view: "accounts" })}
                >
                  管理账号授权
                </button>
              </p>
            ) : account &&
              checkout.repositoryId &&
              !st.access.some(
                (a) =>
                  a.accountId === account.id &&
                  a.repositoryId === checkout.repositoryId,
              ) ? (
              <p className="subtle-note" role="status">
                此仓库未出现在 {account.login}{" "}
                最近的同步列表中。可先同步仓库或检查 GitHub
                权限；本地文件仍可管理。
              </p>
            ) : null}
            {tab === "overview" && (
              <>
                <section className="git-overview">
                  <div className="section-heading">
                    <h3>工作区状态</h3>
                    <span>
                      {status.data?.files.length === 0
                        ? "工作区干净"
                        : status.data
                          ? `${status.data.files.length} 个文件有变更`
                          : "读取中"}
                    </span>
                  </div>
                  <div className="branch-summary">
                    <GitBranch size={18} />
                    <strong>{status.data?.branch || "—"}</strong>
                    {status.data?.upstream && (
                      <span>跟踪 {status.data.upstream}</span>
                    )}
                    <span className="ahead-behind">
                      <ArrowUp size={13} />
                      {status.data?.ahead ?? 0}
                      <ArrowDown size={13} />
                      {status.data?.behind ?? 0}
                    </span>
                  </div>
                  <div className="git-actions">
                    <button
                      disabled={networkUnavailable}
                      onClick={() => void network("fetch")}
                    >
                      Fetch
                    </button>
                    <button
                      disabled={networkUnavailable}
                      onClick={() => void network("pull")}
                    >
                      <ArrowDown size={14} />
                      Pull
                    </button>
                    <button
                      disabled={networkUnavailable}
                      onClick={() => void network("push")}
                    >
                      <ArrowUp size={14} />
                      Push
                    </button>
                  </div>
                  <p className="subtle-note">
                    Pull 仅允许快进更新。分支分叉时会停止，保留现有修改。
                  </p>
                </section>
                <section>
                  <div className="section-heading">
                    <h3>本地目录</h3>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => setForgetOpen(true)}
                    >
                      移出管理
                    </button>
                  </div>
                  <p className="path-text">{checkout.path}</p>
                  <div className="external-actions">
                    {[
                      { kind: "folder", label: "文件夹", Icon: FolderOpen },
                      { kind: "terminal", label: "终端", Icon: Terminal },
                      { kind: "editor", label: "编辑器", Icon: Code2 },
                    ].map(({ kind, label, Icon }) => (
                      <button
                        key={kind}
                        onClick={() =>
                          void execute(() =>
                            api("OpenCheckout", checkout.id, kind),
                          )
                        }
                      >
                        <Icon size={15} />
                        {label}
                      </button>
                    ))}
                  </div>
                </section>
                <section>
                  <div className="section-heading">
                    <h3>远程仓库</h3>
                    {row.repository && (
                      <button className="text-button" onClick={onClone}>
                        <Plus size={14} />
                        新建副本
                      </button>
                    )}
                  </div>
                  {remotes.length ? (
                    remotes.map((r) => (
                      <div className="remote-row" key={r.name}>
                        <strong>{r.name}</strong>
                        <code>{r.url}</code>
                        {r.url.startsWith("git@github.com:") ||
                        r.url.startsWith("ssh://git@github.com/") ? (
                          <button
                            className="text-button"
                            onClick={() => {
                              setRemote(r.name);
                              setBindingOpen(true);
                            }}
                          >
                            转换 HTTPS
                          </button>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <p className="empty-note">此仓库尚未配置 remote。</p>
                  )}
                </section>
              </>
            )}
            {tab === "changes" && (
              <Changes
                key={checkout.id}
                checkout={checkout}
                remote={selectedRemote}
                status={status.data}
                canCommit={!verifying && !!account && !!profile}
                busy={busy}
                execute={execute}
              />
            )}
            {tab === "branches" && (
              <Branches
                key={checkout.id}
                checkout={checkout}
                execute={execute}
                busy={busy}
              />
            )}
            {tab === "history" && <History checkout={checkout} />}
          </>
        ) : (
          <div className="uncloned">
            <Download size={30} strokeWidth={1.3} />
            <h3>把仓库接到本地</h3>
            <p>
              选择访问账号和提交身份，
              <br />
              克隆后即可在这里管理分支与变更。
            </p>
            {row.repository && (
              <button className="primary" onClick={onClone}>
                <Download size={16} />
                克隆仓库
              </button>
            )}
          </div>
        )}
      </div>
      {forgetOpen && checkout && (
        <Modal
          title="将此本地副本移出管理？"
          onClose={() => setForgetOpen(false)}
        >
          <p className="form-description">
            只移除 Repo Berth 中的目录记录和身份绑定，不会删除文件、目录或 Git
            提交。以后可以再次导入。
          </p>
          <p className="path-text">{checkout.path}</p>
          <div className="form-actions">
            <button onClick={() => setForgetOpen(false)}>取消</button>
            <button
              className="primary"
              onClick={() =>
                void execute(async () => {
                  await api("ForgetCheckout", checkout.id);
                  setForgetOpen(false);
                  if (!row.repository && row.checkouts.length === 1) onBack();
                })
              }
            >
              移出管理
            </button>
          </div>
        </Modal>
      )}
      {bindingOpen && checkout && (
        <BindingModal
          checkout={checkout}
          remote={selectedRemote}
          st={st}
          remoteURL={remotes.find((r) => r.name === selectedRemote)?.url || ""}
          execute={execute}
          onClose={() => setBindingOpen(false)}
        />
      )}
      {groupOpen && (
        <Modal title="仓库分组" onClose={() => setGroupOpen(false)}>
          {st.groups.length === 0 ? (
            <p className="empty-note">请先在左侧创建分组。</p>
          ) : (
            st.groups.map((g) => (
              <label key={g.id} className="checkbox-label group-option">
                <input
                  type="checkbox"
                  checked={g.members.includes(row.id)}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    void execute(() =>
                      api("SaveGroup", {
                        ...g,
                        members: checked
                          ? [...g.members, row.id]
                          : g.members.filter((id) => id !== row.id),
                      }),
                    );
                  }}
                />
                {g.name}
              </label>
            ))
          )}
          <div className="form-actions">
            <button onClick={() => setGroupOpen(false)}>完成</button>
          </div>
        </Modal>
      )}
    </>
  );
}
export function BindingModal({
  checkout: c,
  remote,
  remoteURL,
  st,
  execute,
  onClose,
  initialAccountID,
}: {
  checkout: Checkout;
  remote: string;
  remoteURL: string;
  st: State;
  execute: Execute;
  onClose: () => void;
  initialAccountID?: string;
}) {
  const existing = st.bindings.find(
    (b) => b.checkoutId === c.id && b.remote === remote,
  );
  const [account, setAccount] = useState(
    initialAccountID ||
      existing?.accountId ||
      st.settings.defaultAccountId ||
      "",
  );
  const [confirmHTTPS, setConfirmHTTPS] = useState(false);
  const [busy, setBusy] = useState(false);
  const ssh =
    remoteURL.startsWith("git@github.com:") ||
    remoteURL.startsWith("ssh://git@github.com/");
  return (
    <Modal title={`配置 ${remote} 的访问账号`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void execute(async () => {
            setBusy(true);
            try {
              if (confirmHTTPS) await api("ConvertRemoteHTTPS", c.id, remote);
              await api("SetAccessAccount", c.id, remote, account);
              onClose();
            } finally {
              setBusy(false);
            }
          });
        }}
      >
        <p className="path-text">{c.path}</p>
        <Field label="访问账号">
          <select
            value={account}
            onChange={(e) => {
              setAccount(e.target.value);
            }}
          >
            <option value="" disabled>
              选择 GitHub 账号
            </option>
            {st.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.login}
              </option>
            ))}
          </select>
        </Field>
        {ssh && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={confirmHTTPS}
              onChange={(e) => setConfirmHTTPS(e.target.checked)}
            />
            将此 remote 的 SSH 地址转换为 HTTPS，以启用应用内网络操作
          </label>
        )}
        <p className="subtle-note">
          绑定只作用于应用内操作。Git 全局配置与外部工具的身份不受影响。
        </p>
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={!account || busy}>
            保存账号
          </button>
        </div>
        <p className="subtle-note">
          访问账号用于 Fetch / Pull /
          Push。提交姓名和邮箱在设置或项目设置中单独配置。
        </p>
      </form>
    </Modal>
  );
}
function Changes({
  checkout: c,
  remote,
  status,
  canCommit,
  busy,
  execute,
}: {
  checkout: Checkout;
  remote: string;
  status?: GitStatus;
  canCommit: boolean;
  busy: boolean;
  execute: Execute;
}) {
  const [selected, setSelected] = useState<{
    file: FileStatus;
    staged: boolean;
  }>();
  const message = useUI((s) => s.commitDrafts[c.id] || "");
  const setMessage = (value: string) =>
    useUI.getState().setCommitDraft(c.id, value);
  const submitted = useUI((s) => Boolean(s.commitSubmissions[c.id]));
  const [sending, setSending] = useState(false);
  const diff = useQuery({
    queryKey: ["git", "diff", c.id, selected?.file.path, selected?.staged],
    queryFn: () => api("GitDiff", c.id, selected!.file.path, selected!.staged),
    enabled: !!selected,
  });
  const files = status?.files || [];
  const staged = files.filter((f) => f.index !== " " && f.index !== "?");
  const unstaged = files.filter((f) => f.worktree !== " " || f.index === "?");
  return (
    <section>
      <div className="section-heading">
        <h3>文件变更</h3>
        <span>{files.length} 个文件</span>
      </div>
      {[
        { title: "已暂存", files: staged, staged: true },
        { title: "未暂存", files: unstaged, staged: false },
      ].map((group) => (
        <div className="file-group" key={group.title}>
          <h4>
            {group.title} <span>{group.files.length}</span>
          </h4>
          {group.files.length === 0 ? (
            <p className="empty-note">没有{group.title}的文件。</p>
          ) : (
            group.files.map((f) => (
              <div className="file-row" key={f.path}>
                <button
                  className="file-name"
                  onClick={() => setSelected({ file: f, staged: group.staged })}
                >
                  <code className="file-change-code">
                    {group.staged ? f.index : f.worktree}
                  </code>
                  <span>
                    {f.originalPath ? `${f.originalPath} → ` : ""}
                    {f.path}
                  </span>
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void execute(() =>
                      api("StageFile", c.id, f.path, !group.staged),
                    )
                  }
                >
                  {group.staged ? "取消暂存" : "暂存"}
                </button>
              </div>
            ))
          )}
        </div>
      ))}
      {selected && (
        <div className="diff-view">
          <div className="section-heading">
            <h4>{selected.file.path}</h4>
            <span>{selected.staged ? "已暂存" : "工作区"}</span>
          </div>
          {diff.isPending ? (
            <Loading />
          ) : diff.isError ? (
            <ErrorNotice message={errorMessage(diff.error)} />
          ) : (
            <pre>
              <code>
                {diff.data ||
                  "此文件暂无可显示的文本差异（未跟踪文件请先暂存）。"}
              </code>
            </pre>
          )}
        </div>
      )}
      <form
        className="commit-form"
        onSubmit={(e) => {
          e.preventDefault();
          void execute(async () => {
            setSending(true);
            try {
              const taskId = await api("CommitChanges", c.id, remote, message);
              useUI.getState().submitCommitDraft(c.id, taskId, message);
            } finally {
              setSending(false);
            }
          });
        }}
      >
        <Field label="提交信息">
          <textarea
            required
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="描述这次修改…"
          />
        </Field>
        <div className="form-actions">
          <span>
            {!canCommit
              ? "请先绑定访问账号和提交身份"
              : `${staged.length} 个已暂存文件`}
          </span>
          <button
            className="primary"
            disabled={
              busy ||
              sending ||
              submitted ||
              !canCommit ||
              !staged.length ||
              !message.trim()
            }
          >
            <GitCommitHorizontal size={16} />
            提交
          </button>
        </div>
      </form>
    </section>
  );
}
function Branches({
  checkout: c,
  execute,
  busy,
}: {
  checkout: Checkout;
  execute: Execute;
  busy: boolean;
}) {
  const [name, setName] = useState("");
  const branches = useQuery({
    queryKey: ["git", "branches", c.id],
    queryFn: () => api("GitBranches", c.id),
  });
  return (
    <section>
      <div className="section-heading">
        <h3>本地分支</h3>
      </div>
      {branches.isPending ? (
        <Loading />
      ) : branches.isError ? (
        <ErrorNotice message={errorMessage(branches.error)} />
      ) : (
        branches.data.map((b) => (
          <div className="branch-row" key={b.name}>
            <GitBranch size={16} />
            <strong>{b.name}</strong>
            {b.current ? (
              <span className="pill neutral">当前分支</span>
            ) : (
              <button
                disabled={busy}
                onClick={() =>
                  void execute(() => api("SwitchBranch", c.id, b.name, false))
                }
              >
                切换
              </button>
            )}
          </div>
        ))
      )}
      <form
        className="branch-form"
        onSubmit={(e) => {
          e.preventDefault();
          void execute(async () => {
            await api("SwitchBranch", c.id, name, true);
            setName("");
          });
        }}
      >
        <Field label="新建并切换分支">
          <span className="joined">
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="feature/my-change"
            />
            <button disabled={busy || !name.trim()}>
              <Plus size={16} />
              创建
            </button>
          </span>
        </Field>
      </form>
    </section>
  );
}
function History({ checkout: c }: { checkout: Checkout }) {
  const history = useQuery({
    queryKey: ["git", "history", c.id],
    queryFn: () => api("GitHistory", c.id),
  });
  return (
    <section>
      <div className="section-heading">
        <h3>最近提交</h3>
        <span>最多 50 条</span>
      </div>
      {history.isPending ? (
        <Loading />
      ) : history.isError ? (
        <ErrorNotice message={errorMessage(history.error)} />
      ) : history.data.length === 0 ? (
        <p className="empty-note">此仓库尚无提交。</p>
      ) : (
        <div className="commit-history">
          {history.data.map((commit) => (
            <article key={commit.hash}>
              <GitCommitHorizontal size={17} />
              <div>
                <strong>{commit.subject}</strong>
                <p>
                  {commit.author} &lt;{commit.email}&gt;
                </p>
                <small>{new Date(commit.date).toLocaleString("zh-CN")}</small>
              </div>
              <code title={commit.hash}>{commit.hash.slice(0, 7)}</code>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
