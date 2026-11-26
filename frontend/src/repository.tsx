import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Download,
  FolderGit2,
  Upload,
  Github,
} from "lucide-react";
import { api, errorMessage } from "./api";
import type {
  State,
  Repository,
  Checkout,
  Task,
} from "./types";
import type { Execute } from "./catalog";
import { refreshCheckoutQueries } from "./git-refresh";
import {
  DirectoryField,
  ErrorNotice,
  Field,
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
  const client = useQueryClient();
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
              if (confirmHTTPS) {
                await api("ConvertRemoteHTTPS", c.id, remote);
                await refreshCheckoutQueries(client, c.id, ["status"]);
              }
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
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={!account || busy}>
            保存账号
          </button>
        </div>
      </form>
    </Modal>
  );
}
