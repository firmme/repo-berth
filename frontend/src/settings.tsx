import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Plus,
  Github,
  Copy,
  Check,
  ExternalLink,
  KeyRound,
  Trash2,
  Save,
  GitCommitHorizontal,
  Settings2,
  UsersRound,
  Terminal,
  FolderOpen,
  Code2,
  Download,
  Pencil,
  RefreshCw,
  X,
} from "lucide-react";
import { api, errorMessage, isDesktop } from "./api";
import { useUI } from "./ui";
import type { Account, Authorization, Profile, State } from "./types";
import type { Execute } from "./App";
import {
  AccountMark,
  DirectoryField,
  ErrorNotice,
  Field,
  Modal,
} from "./components";

export function AccountsView({ st, execute }: { st: State; execute: Execute }) {
  const [auth, setAuth] = useState<Authorization>();
  const [codeCopied, setCodeCopied] = useState(false);
  const [remove, setRemove] = useState<Account>();
  const [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [newProfileAccount, setNewProfileAccount] = useState<Account>();
  const [tokenAccount, setTokenAccount] = useState<Account | null>();
  const [cliAccount, setCLIAccount] = useState<Account | null>();
  const begin = (id = "") =>
    execute(async () => {
      setBusy(true);
      setRecovering(false);
      try {
        const authorization = await api("StartAuthorization", false, id);
        setAuth(authorization);
        setCodeCopied(false);
        try {
          if (isDesktop) {
            const { Clipboard } = await import("@wailsio/runtime");
            await Clipboard.SetText(authorization.userCode);
          } else {
            await navigator.clipboard.writeText(authorization.userCode);
          }
          setCodeCopied(true);
        } catch {
          // The visible copy button remains available if clipboard access fails.
        }
      } finally {
        setBusy(false);
      }
    });
  const task = auth ? st.tasks.find((t) => t.id === auth.taskId) : undefined;
  const connectedAccount = st.accounts.find((a) => a.id === task?.target);
  const recover = (session: boolean) =>
    execute(async () => {
      if (!auth) return;
      setBusy(true);
      try {
        const next = await api("RecoverAuthorization", auth.taskId, session);
        setAuth({ ...auth, taskId: next });
        setRecovering(true);
      } finally {
        setBusy(false);
      }
    });
  return (
    <div className="page-content account-page">
      <div className="page-heading inset-heading">
        <div>
          <h1>账号与身份</h1>
        </div>
        <div className="actions">
        <button className="primary" onClick={() => setCLIAccount(null)}><Github size={16} />通过 GitHub CLI 登录</button>
        <button onClick={() => setTokenAccount(null)}><KeyRound size={16} />使用 Token 添加账号</button>
        <button
          disabled={busy || !st.githubAuthConfigured}
          title={
            !st.githubAuthConfigured
              ? "此构建缺少应用登录配置，请使用已配置登录的版本"
              : undefined
          }
          onClick={() => void begin()}
        >
          <Plus size={16} />
          添加 GitHub 账号
        </button>
        </div>
      </div>
      <CredentialCleanupNotice st={st} execute={execute} />
      {!st.githubAuthConfigured && (
        <div className="authorization-note">
          <Settings2 size={18} />
          <div>
            <strong>此构建的 GitHub 浏览器登录暂不可用</strong>
            <p>
              应用发布配置缺失。使用者无需创建 OAuth 应用或填写 Client
              ID。可使用 Token 添加账号，或使用已配置浏览器登录的版本。
            </p>
          </div>
        </div>
      )}
      {st.accounts.length === 0 ? (
        <div className="account-empty">
          <Github size={30} strokeWidth={1.2} />
          <h2>连接你的第一个 GitHub 账号</h2>
          <p>
            可以同时连接多个 GitHub 账号。
            <br />
            可在浏览器中授权，或使用各账号自己的 Personal Access Token。
          </p>
        </div>
      ) : (
        st.accounts.map((a) => (
          <AccountPanel
            key={a.id}
            account={a}
            st={st}
            execute={execute}
            onAuthorize={() => void begin(a.id)}
            onToken={() => setTokenAccount(a)}
            onCLI={() => setCLIAccount(a)}
            onRemove={() => setRemove(a)}
          />
        ))
      )}
      {auth && (
        <Modal title="确认 GitHub 授权" onClose={() => setAuth(undefined)}>
          <div className="device-flow">
            <Github size={30} />
            {task?.state === "succeeded" ? (
              <>
                <h3>账号已连接</h3>
                <p>
                  {connectedAccount?.login
                    ? `${connectedAccount.login} 已连接。`
                    : ""}
                  请确认账号，并设置提交姓名和邮箱。
                </p>
                <button
                  className="primary"
                  onClick={() => {
                    setAuth(undefined);
                    if (connectedAccount)
                      setNewProfileAccount(connectedAccount);
                  }}
                >
                  设置提交身份
                </button>
              </>
            ) : task?.canResumeAuthorization ? (
              <>
                <h3>浏览器授权已完成</h3>
                <p>
                  凭据尚未保存。你可以解锁系统凭据库后重试，或明确选择只在本次应用会话保存，无需再次打开浏览器。
                </p>
                {task.error && <ErrorNotice message={task.error} />}
                <div className="actions">
                  <button disabled={busy} onClick={() => void recover(false)}>
                    重新保存到系统凭据库
                  </button>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void recover(true)}
                  >
                    仅本次会话保存
                  </button>
                </div>
                {task.authorizationRecoveryExpiresAt && (
                  <p className="muted">
                    恢复操作可用至{" "}
                    {new Date(
                      task.authorizationRecoveryExpiresAt,
                    ).toLocaleTimeString("zh-CN")}
                    。关闭应用或取消授权会丢弃这次未保存的凭据。
                  </p>
                )}
                <button
                  onClick={() =>
                    void execute(async () => {
                      await api("CancelTask", task.id);
                      setAuth(undefined);
                    })
                  }
                >
                  取消并丢弃本次授权
                </button>
              </>
            ) : task &&
              ["failed", "cancelled", "interrupted"].includes(task.state) &&
              !recovering ? (
              <>
                <h3>本次授权未完成</h3>
                {task.error && <ErrorNotice message={task.error} />}
                <p>请重新发起授权并确认浏览器中的 GitHub 账号。</p>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => {
                    setAuth(undefined);
                    void begin();
                  }}
                >
                  重新打开浏览器授权
                </button>
              </>
            ) : recovering ? (
              <>
                <h3>
                  {task?.state === "failed" || task?.state === "cancelled"
                    ? "授权未能保存"
                    : "正在保存授权"}
                </h3>
                <p>
                  本次保存使用已完成的 GitHub 授权，正在处理本设备上的凭据记录。
                </p>
                {task?.error && <ErrorNotice message={task.error} />}
                <button
                  onClick={() =>
                    void execute(async () => {
                      await api("CancelTask", auth.taskId);
                      setAuth(undefined);
                    })
                  }
                >
                  {task?.state === "failed" || task?.state === "cancelled"
                    ? "关闭"
                    : "取消保存"}
                </button>
              </>
            ) : (
              <>
                <p>在浏览器中输入验证码，并确认当前登录的是你要添加的账号。</p>
                <div className="device-code">
                  <code>{auth.userCode}</code>
                  <button
                    aria-label="复制验证码"
                    onClick={() => {
                      void (async () => {
                        try {
                          if (isDesktop) {
                            const { Clipboard } = await import("@wailsio/runtime");
                            await Clipboard.SetText(auth.userCode);
                          } else await navigator.clipboard.writeText(auth.userCode);
                          setCodeCopied(true);
                        } catch { setCodeCopied(false); }
                      })();
                    }}
                  >
                    {codeCopied ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                </div>
                <p className="muted" role="status">{codeCopied ? "验证码已自动复制，可直接粘贴" : "请点击复制按钮复制验证码"}</p>
                <a
                  href={auth.verificationUri}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => {
                    if (isDesktop) {
                      e.preventDefault();
                      void execute(() => api("OpenGitHubPage", "device"));
                    }
                  }}
                >
                  打开 GitHub 授权页面 <ExternalLink size={14} />
                </a>
                <p className="muted">
                  验证码有效期 {Math.ceil(auth.expiresIn / 60)}{" "}
                  分钟。关闭窗口不会取消授权任务。
                </p>
                {task?.error && <ErrorNotice message={task.error} />}
                <button
                  onClick={() =>
                    void execute(async () => {
                      await api("CancelTask", auth.taskId);
                      setAuth(undefined);
                    })
                  }
                >
                  取消授权
                </button>
              </>
            )}
          </div>
        </Modal>
      )}
      {tokenAccount !== undefined && <TokenAccountModal account={tokenAccount} st={st} execute={execute} onClose={() => setTokenAccount(undefined)} />}
      {cliAccount !== undefined && <CLIAccountModal account={cliAccount} st={st} execute={execute} onClose={() => setCLIAccount(undefined)} />}
      {remove && (
        <Modal
          title={`移除 ${remove.login}？`}
          onClose={() => setRemove(undefined)}
        >
          <p className="form-description">
            将清除本设备中的账号凭据，相关仓库需要重新绑定。已克隆的目录和文件会保留。GitHub
            网站上的授权可在 GitHub 设置中另行撤销。
          </p>
          <div className="form-actions">
            <button onClick={() => setRemove(undefined)}>
              <X size={14} />
              取消
            </button>
            <button
              className="danger"
              onClick={() =>
                void execute(async () => {
                  await api("RemoveAccount", remove.id);
                  setRemove(undefined);
                })
              }
            >
              <Trash2 size={14} />
              移除账号
            </button>
          </div>
        </Modal>
      )}
      {newProfileAccount && (
        <ProfileModal
          account={newProfileAccount}
          execute={execute}
          onClose={() => setNewProfileAccount(undefined)}
        />
      )}
    </div>
  );
}
function AccountPanel({
  account: a,
  st,
  execute,
  onAuthorize,
  onToken,
  onCLI,
  onRemove,
}: {
  account: Account;
  st: State;
  execute: Execute;
  onAuthorize: () => void;
  onToken: () => void;
  onCLI: () => void;
  onRemove: () => void;
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const profile = st.profiles.find((p) => p.accountId === a.id);
  return (
    <section className="account-panel">
      <div className="account-panel-header">
        <AccountMark account={a} />
        <div>
          <h2>
            {a.login}{" "}
            <span
              className={`pill ${a.status === "connected" ? "positive" : "warning"}`}
            >
              {a.status === "connected" ? "已连接" : "需重新授权"}
            </span>
          </h2>
          <p>
            {a.name || "GitHub"} · github.com · {a.authentication === "pat" ? "Personal Access Token" : a.authentication === "github-cli" ? "GitHub CLI" : "OAuth"}
            {a.sessionOnly ? " · 仅本次会话" : ""}
          </p>
        </div>
        <div className="actions">
          <button
            className="icon-button"
            aria-label={`移除 ${a.login}`}
            onClick={onRemove}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      <div className="profile-heading">
        <h3>
          <GitCommitHorizontal size={16} />
          提交信息
        </h3>
        <button
          className="text-button"
          onClick={() => setProfileOpen(true)}
        >
          {profile ? "编辑" : "设置"}
        </button>
      </div>
      {!profile ? (
        <p className="empty-note">
          尚未设置提交姓名和邮箱。克隆或提交前请先设置。
        </p>
      ) : (
        <div className="profile-row">
          <strong>{profile.name}</strong>
          <span>{profile.email}</span>
        </div>
      )}
      <div className="account-footer actions">
        <button className="text-button" onClick={onCLI}>{a.authentication === "github-cli" ? "更新 CLI 登录" : "改用 GitHub CLI"}</button>
        <button className="text-button" onClick={onToken}>
          <KeyRound size={14} />{a.authentication === "pat" ? "更新 Token" : "改用 Token"}
        </button>
        {!a.authentication && <button className="text-button" disabled={!st.githubAuthConfigured} onClick={onAuthorize}>
          重新授权
        </button>}
        {!a.authentication &&
        <a href="https://github.com/settings/applications" target="_blank" rel="noreferrer" onClick={(e) => {
          if (isDesktop) {
            e.preventDefault();
            void execute(() => api("OpenGitHubPage", "authorizations"));
          }
        }}>
          组织访问授权 <ExternalLink size={14} />
        </a>}
        <button className="text-button" onClick={() => void execute(() => api("SyncRepositories", a.id))}>
          <RefreshCw size={14} />同步仓库
        </button>
      </div>
      {profileOpen && (
        <ProfileModal
          account={a}
          existing={profile}
          execute={execute}
          onClose={() => setProfileOpen(false)}
        />
      )}
    </section>
  );
}
function CLIAccountModal({ account, st, execute, onClose }: { account: Account | null; st: State; execute: Execute; onClose: () => void }) {
  const accounts = useQuery({ queryKey: ["github-cli-accounts"], queryFn: () => api("GitHubCLIAccounts"), retry: false });
  const [taskID, setTaskID] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const task = st.tasks.find((t) => t.id === taskID);
  const pending = !!taskID && (!task || ["queued", "running"].includes(task.state));
  const connect = (login: string, browser: boolean) => execute(async () => {
    setBusy(true); setError("");
    try { setTaskID(await api("ConnectGitHubCLI", login, account?.id || "", browser)); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  });
  return <Modal title={account ? `通过 GitHub CLI 连接 ${account.login}` : "通过官方 GitHub CLI 连接账号"} onClose={onClose}>
    {task?.state === "succeeded" ? <>
      <p>已连接 {st.accounts.find((a) => a.id === task.target)?.login || account?.login || "GitHub 账号"}，后续仓库操作使用这个账号的独立凭据。</p>
      <div className="form-actions"><button className="primary" onClick={() => void execute(async () => { await api("SyncRepositories", task.target); onClose(); })}>同步仓库</button></div>
    </> : <>
      <p>通过官方 GitHub CLI 登录，或连接已登录的账号。无需手动复制 Token，可继续在 Repo Berth 中管理多个账号。</p>
      {account && <p>请选择 {account.login}，验证账号归属后才会替换原凭据。</p>}
      {accounts.isPending && <p role="status">正在读取 GitHub CLI 账号…</p>}
      {accounts.error && <ErrorNotice message={errorMessage(accounts.error)} />}
      {accounts.data?.length === 0 && <p className="empty-note">尚无已登录的 CLI 账号，可直接在浏览器登录。</p>}
      {accounts.data?.filter((a) => !account || a.login.toLowerCase() === account.login.toLowerCase()).map((a) => <div className="profile-row" key={a.login}>
        <strong>{a.login}</strong>
        <button disabled={busy || pending || a.state !== "success"} onClick={() => void connect(a.login, false)}>{a.state === "success" ? "连接此账号" : "需要重新登录"}</button>
      </div>)}
      {(error || task?.error) && <ErrorNotice message={error || task?.error || ""} />}
      {pending && <>
        <p role="status">{task?.progress || "正在通过 GitHub CLI 连接账号…"}</p>
        <a href="https://github.com/login/device" target="_blank" rel="noreferrer" onClick={(e) => { if (isDesktop) { e.preventDefault(); void execute(() => api("OpenGitHubPage", "device")); } }}>打开 GitHub 验证页面 <ExternalLink size={14} /></a>
      </>}
      {task?.canResumeAuthorization && <div className="actions">
        <button onClick={() => void execute(async () => setTaskID(await api("RecoverAuthorization", taskID, false)))}>重试保存</button>
        <button onClick={() => void execute(async () => setTaskID(await api("RecoverAuthorization", taskID, true)))}>仅本次会话保存</button>
      </div>}
      <div className="form-actions">
        {pending ? <button onClick={() => void execute(async () => { await api("CancelTask", taskID); setTaskID(""); })}>取消登录</button> : <button className="primary" disabled={busy} onClick={() => void connect("", true)}>在浏览器登录{account ? ` ${account.login}` : "另一个账号"}</button>}
        <button disabled={busy || pending} onClick={() => void accounts.refetch()}>刷新账号</button>
      </div>
      <p className="muted">需要安装官方 GitHub CLI。浏览器登录会更新 CLI 的当前账号；Repo Berth 的仓库访问仍按各自绑定账号选择凭据。</p>
      <a href="https://cli.github.com/" target="_blank" rel="noreferrer" onClick={(e) => { if (isDesktop) { e.preventDefault(); void execute(() => api("OpenGitHubPage", "cli")); } }}>获取官方 GitHub CLI <ExternalLink size={14} /></a>
    </>}
  </Modal>;
}

function TokenAccountModal({ account, st, execute, onClose }: { account: Account | null; st: State; execute: Execute; onClose: () => void }) {
  const [token, setToken] = useState("");
  const [sessionOnly, setSessionOnly] = useState(false);
  const [taskID, setTaskID] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const task = st.tasks.find((t) => t.id === taskID);
  const pending = !!taskID && (!task || ["queued", "running"].includes(task.state));
  const save = () => execute(async () => {
    setBusy(true);
    setError("");
    try {
      const id = await api("ConnectToken", token, sessionOnly, account?.id || "");
      setToken("");
      setTaskID(id);
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  });
  return <Modal title={account ? `更新 ${account.login} 的访问凭据` : "使用 Token 添加 GitHub 账号"} onClose={onClose}>
    {task?.state === "succeeded" ? <>
      <p>已连接 {st.accounts.find((a) => a.id === task.target)?.login || account?.login || "GitHub 账号"}。Token 已按账号独立保存，仓库绑定和提交身份保持不变。</p>
      <div className="form-actions"><button className="primary" onClick={() => void execute(async () => { await api("SyncRepositories", task.target); onClose(); })}>同步仓库</button></div>
    </> : <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <p>使用你自己的 Personal Access Token 访问仓库，每个账号独立保存和使用。</p>
      <p className="muted" id="token-permissions">Classic Token 选择 repo；修改 Actions 工作流还需 workflow。Fine-grained Token 需选择目标仓库，并授予 Contents 读写权限。组织的 Token 策略和 SSO 仍适用。</p>
      <a href="https://github.com/settings/tokens/new?scopes=repo,workflow&description=Repo%20Berth" target="_blank" rel="noreferrer" onClick={(e) => { if (isDesktop) { e.preventDefault(); void execute(() => api("OpenGitHubPage", "new-token")); } }}>创建 GitHub Token <ExternalLink size={14} /></a>
      {account && <p>Token 必须属于 {account.login}，验证通过后才会替换原凭据。</p>}
      <Field label="Personal Access Token"><input autoFocus required type="password" autoComplete="off" spellCheck={false} aria-describedby="token-permissions" value={token} disabled={busy || pending} onChange={(e) => setToken(e.target.value)} /></Field>
      <label><input type="checkbox" checked={sessionOnly} disabled={busy || pending} onChange={(e) => setSessionOnly(e.target.checked)} />仅本次会话保存</label>
      {(error || task?.error) && <ErrorNotice message={error || task?.error || ""} />}
      {pending && <p role="status">正在验证账号并保存凭据…</p>}
      {task?.canResumeAuthorization && <div className="actions">
        <button type="button" onClick={() => void execute(async () => setTaskID(await api("RecoverAuthorization", taskID, false)))}>重试保存</button>
        <button type="button" onClick={() => void execute(async () => setTaskID(await api("RecoverAuthorization", taskID, true)))}>仅本次会话保存</button>
      </div>}
      <div className="form-actions"><button type="button" onClick={onClose}>关闭</button><button className="primary" type="submit" disabled={busy || pending || !token.trim()}>验证并保存</button></div>
    </form>}
  </Modal>;
}
function ProfileModal({
  account,
  existing,
  execute,
  onClose,
}: {
  account: Account;
  existing?: Profile;
  execute: Execute;
  onClose: () => void;
}) {
  const [name, setName] = useState(
    existing?.name || account.name || account.login,
  );
  const [email, setEmail] = useState(existing?.email || "");
  const emails = useQuery({
    queryKey: ["emails", account.id],
    queryFn: () => api("AccountEmails", account.id),
  });
  return (
    <Modal title={`确认 ${account.login} 的提交身份`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void execute(async () => {
            const profile: Profile = {
              id: existing?.id || "",
              accountId: account.id,
              name,
              email,
            };
            await api("SaveProfile", profile);
            onClose();
          });
        }}
      >
        <p className="form-description">
          这些信息会写入 Git 提交记录，不代表访问仓库时使用的登录账号。
        </p>
        <Field label="提交姓名">
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="提交邮箱">
          <input
            type="email"
            required
            list="account-emails"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="选择已验证邮箱或手动填写"
          />
          <datalist id="account-emails">
            {emails.data
              ?.filter((e) => e.verified)
              .map((e) => (
                <option key={e.email} value={e.email}>
                  {e.primary ? "主要邮箱" : "已验证邮箱"}
                </option>
              ))}
          </datalist>
        </Field>
        {emails.isError && (
          <p className="muted">无法获取账号邮箱，你仍可手动填写。</p>
        )}
        {existing && (
          <p className="subtle-note">
            保存后，绑定此身份的仓库将在下次操作中使用新信息；已排队的提交会要求重新确认。
          </p>
        )}
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            <X size={14} />
            取消
          </button>
          <button className="primary">
            <Check size={15} />
            保存身份
          </button>
        </div>
      </form>
    </Modal>
  );
}
type TerminalChoice = { value: string; label: string };

function terminalChoices(): TerminalChoice[] {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua))
    return [
      { value: "powershell.exe", label: "Windows PowerShell" },
      { value: "pwsh.exe", label: "PowerShell 7" },
      { value: "wt.exe", label: "Windows Terminal" },
      { value: "cmd.exe", label: "命令提示符" },
    ];
  if (/Macintosh|Mac OS X/i.test(ua))
    return [
      { value: "Terminal", label: "终端.app" },
      { value: "iTerm", label: "iTerm" },
    ];
  return [
    { value: "x-terminal-emulator", label: "系统默认终端" },
    { value: "gnome-terminal", label: "GNOME Terminal" },
    { value: "kgx", label: "GNOME Console" },
    { value: "konsole", label: "Konsole" },
    { value: "xfce4-terminal", label: "Xfce Terminal" },
  ];
}

export function SettingsView({ st, execute }: { st: State; execute: Execute }) {
  const [settings, setSettings] = useState(st.settings);
  const [saved, setSaved] = useState(false);
  const [version, setVersion] = useState("");
  const [versionError, setVersionError] = useState("");
  const choices = terminalChoices();
  const [customTerminal, setCustomTerminal] = useState(
    !!settings.terminalPath &&
      !choices.some((choice) => choice.value === settings.terminalPath),
  );
  return (
    <div className="page-content settings-page">
      <div className="page-heading inset-heading">
        <div>
          <h1><Settings2 size={18} /> 设置</h1>
        </div>
      </div>
      <CredentialCleanupNotice st={st} execute={execute} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void execute(async () => {
            await api("SaveSettings", settings);
            setSaved(true);
          });
        }}
        onChange={() => setSaved(false)}
      >
        <section className="settings-row">
          <div>
            <h2><UsersRound size={16} /> GitHub 账号</h2>
          </div>
          <div className="settings-panel">
            <button
              type="button"
              onClick={() => useUI.getState().set({ view: "accounts" })}
            >
              <UsersRound size={15} />
              管理 GitHub 账号
            </button>
          </div>
        </section>
        <section className="settings-row">
          <div>
            <h2><Terminal size={16} /> Git 环境</h2>
          </div>
          <div className="settings-panel">
            <Field label="Git 可执行文件">
              <input
                required
                value={settings.gitPath}
                onChange={(e) =>
                  setSettings({ ...settings, gitPath: e.target.value })
                }
              />
            </Field>
            <button
              type="button"
              onClick={() =>
                void (async () => {
                  try {
                    await api("SaveSettings", settings);
                    setVersion(await api("GitVersion"));
                    setVersionError("");
                  } catch (e) {
                    setVersionError(errorMessage(e));
                  }
                })()
              }
            >
              <RefreshCw size={15} />
              保存并检测 Git
            </button>
            {version && (
              <p className="success-text">
                <Check size={14} />
                {version}
              </p>
            )}
            {versionError && <ErrorNotice message={versionError} />}
          </div>
        </section>
        <section className="settings-row">
          <div>
            <h2><FolderOpen size={16} /> 仓库与外部工具</h2>
          </div>
          <div className="settings-panel">
            <DirectoryField
              label="默认克隆父目录"
              required={false}
              value={settings.cloneDirectory}
              onChange={(value) =>
                setSettings({ ...settings, cloneDirectory: value })
              }
            />
            <Field
              label="编辑器可执行文件"
              hint="留空使用 code"
            >
              <input
                value={settings.editorPath}
                onChange={(e) =>
                  setSettings({ ...settings, editorPath: e.target.value })
                }
                placeholder="code"
              />
            </Field>
            <Field
              label="默认命令行程序"
              hint="“仓库 → 用命令行打开”时使用；自动时 Windows 用 PowerShell、macOS 用终端.app"
            >
              <select
                value={customTerminal ? "__custom" : settings.terminalPath}
                onChange={(e) => {
                  if (e.target.value === "__custom") {
                    setCustomTerminal(true);
                    return;
                  }
                  setCustomTerminal(false);
                  setSettings({ ...settings, terminalPath: e.target.value });
                }}
              >
                <option value="">自动（按平台）</option>
                {choices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
                <option value="__custom">自定义命令…</option>
              </select>
            </Field>
            {customTerminal && (
              <Field label="命令行程序路径" hint="可填写完整路径或命令名">
                <input
                  value={settings.terminalPath}
                  onChange={(e) =>
                    setSettings({ ...settings, terminalPath: e.target.value })
                  }
                  placeholder={choices[0]?.value || "终端可执行文件"}
                />
              </Field>
            )}
          </div>
        </section>
        <section className="settings-row">
          <div>
            <h2><RefreshCw size={16} /> 应用更新</h2>
          </div>
          <div className="settings-panel">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={!settings.autoUpdateDisabled}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    autoUpdateDisabled: !e.target.checked,
                  })
                }
              />
              启动时自动检查更新
            </label>
          </div>
        </section>
        <div className="settings-save">
          <span>{saved ? "设置已保存" : ""}</span>
          <button className="primary">
            <Save size={16} />
            保存设置
          </button>
        </div>
      </form>
    </div>
  );
}
function CredentialCleanupNotice({
  st,
  execute,
}: {
  st: State;
  execute: Execute;
}) {
  const count = st.pendingCredentialCleanupCount || 0;
  if (!count) return null;
  const busy = st.tasks.some(
    (t) =>
      t.kind === "credential_cleanup" &&
      (t.state === "running" || t.state === "queued"),
  );
  return (
    <div className="authorization-note" role="status">
      <KeyRound size={18} />
      <div>
        <strong>{count} 项旧凭据尚未确认清理</strong>
        <p>
          请解锁系统凭据库后重试。当前账号不会使用这些旧凭据，仓库目录和文件不受影响。
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void execute(async () => {
              await api("RetryCredentialCleanup");
            })
          }
        >
          <RefreshCw size={14} />
          {busy ? "正在清理…" : "重试清理旧凭据"}
        </button>
      </div>
    </div>
  );
}
