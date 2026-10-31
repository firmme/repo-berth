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
        <button
          className="primary"
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
      <CredentialCleanupNotice st={st} execute={execute} />
      {!st.githubAuthConfigured && (
        <div className="authorization-note">
          <Settings2 size={18} />
          <div>
            <strong>此构建的 GitHub 登录暂不可用</strong>
            <p>
              应用发布配置缺失。使用者无需创建 OAuth 应用或填写 Client
              ID，请使用已配置登录的版本。
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
            点击“添加 GitHub 账号”，在系统浏览器中确认授权即可。
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
  onRemove,
}: {
  account: Account;
  st: State;
  execute: Execute;
  onAuthorize: () => void;
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
            {a.name || "GitHub"} · github.com
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
      {a.status === "auth_required" && <div className="account-footer"><button className="text-button" onClick={onAuthorize}><KeyRound size={14} />重新授权</button></div>}
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
export function SettingsView({ st, execute }: { st: State; execute: Execute }) {
  const [settings, setSettings] = useState(st.settings);
  const [saved, setSaved] = useState(false);
  const [version, setVersion] = useState("");
  const [versionError, setVersionError] = useState("");
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
            <h2><FolderOpen size={16} /> 仓库与编辑器</h2>
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
              useUI.getState().set({ tasksOpen: true });
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
