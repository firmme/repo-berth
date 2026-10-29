import { useState } from "react";
import { api } from "./api";
import { Field, Modal } from "./components";
import type { Checkout, Profile, State } from "./types";
import type { Execute } from "./catalog";

export function resolveAccessAccount(
  st: State,
  checkout: Checkout | undefined,
  remote: string,
) {
  const binding = st.bindings.find(
    (b) =>
      b.checkoutId === checkout?.id &&
      b.remote === remote &&
      st.accounts.some((a) => a.id === b.accountId),
  );
  const account = st.accounts.find(
    (a) => a.id === (binding?.accountId || st.settings.defaultAccountId),
  );
  const profiles = st.profiles.filter((p) => p.accountId === account?.id);
  const profile =
    st.profiles.find((p) => p.id === binding?.profileId) ||
    (!binding && profiles.length === 1 ? profiles[0] : undefined);
  return {
    binding,
    account,
    profile,
    source: binding
      ? binding.automatic
        ? "自动关联"
        : "仓库绑定"
      : "默认账号",
  };
}

export function githubRepositoryPath(url: string) {
  const match =
    /^(?:https?:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/([^/?#]+?)(?:\.git)?\/?$/i.exec(
      url,
    );
  return match ? `${match[1]}/${match[2]}` : "";
}

export function effectiveCommitIdentity(
  st: State,
  checkout: Checkout,
  legacy?: Profile,
) {
  if (checkout.commitName)
    return { name: checkout.commitName, email: checkout.commitEmail || "" };
  if (st.settings.defaultCommitName)
    return {
      name: st.settings.defaultCommitName,
      email: st.settings.defaultCommitEmail || "",
    };
  return legacy;
}

export function CheckoutIdentity({
  checkout,
  execute,
}: {
  checkout: Checkout;
  execute: Execute;
}) {
  const [custom, setCustom] = useState(!!checkout.commitName);
  const [name, setName] = useState(checkout.commitName || "");
  const [email, setEmail] = useState(checkout.commitEmail || "");
  const [saved, setSaved] = useState(false);
  return (
    <form
      onChange={() => setSaved(false)}
      onSubmit={(e) => {
        e.preventDefault();
        void execute(async () => {
          await api(
            "SetCheckoutIdentity",
            checkout.id,
            custom ? name : "",
            custom ? email : "",
          );
          setSaved(true);
        });
      }}
    >
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={custom}
          onChange={(e) => setCustom(e.target.checked)}
        />
        为此项目单独指定提交信息
      </label>
      {custom ? (
        <>
          <Field label="项目提交姓名">
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="项目提交邮箱">
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
        </>
      ) : (
        <p className="subtle-note">
          使用设置中的默认提交姓名和邮箱。尚未设置默认值时，兼容已有绑定的提交身份。
        </p>
      )}
      <button type="submit">保存项目提交设置</button>
      {saved && <span role="status"> 已保存</span>}
    </form>
  );
}

export function LocalManagement({
  st,
  execute,
  onClose,
}: {
  st: State;
  execute: Execute;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const visible = st.checkouts.filter((c) =>
    (c.name + " " + c.path).toLowerCase().includes(query.toLowerCase()),
  );
  const busy = (id: string) =>
    st.tasks.some(
      (t) => t.target === id && ["running", "queued"].includes(t.state),
    );
  const toggle = (id: string) => {
    setConfirm(false);
    setSelected((v) =>
      v.includes(id) ? v.filter((x) => x !== id) : [...v, id],
    );
  };
  return (
    <Modal title="管理本地目录" onClose={onClose}>
      <p>批量移出应用管理，保留磁盘上的全部文件与 Git 历史。</p>
      <Field label="筛选本地目录">
        <input
          value={query}
          disabled={pending}
          onChange={(e) => {
            setQuery(e.target.value);
            setConfirm(false);
          }}
        />
      </Field>
      <label className="checkbox-label">
        <input
          type="checkbox"
          disabled={pending || !visible.some((c) => !busy(c.id))}
          checked={
            !!visible.length &&
            visible
              .filter((c) => !busy(c.id))
              .every((c) => selected.includes(c.id))
          }
          onChange={(e) => {
            setConfirm(false);
            const ids = visible.filter((c) => !busy(c.id)).map((c) => c.id);
            setSelected((v) =>
              e.target.checked
                ? [...new Set([...v, ...ids])]
                : v.filter((id) => !ids.includes(id)),
            );
          }}
        />
        选择当前列表
      </label>
      <div className="local-management-list">
        {visible.map((c) => (
          <label className="local-management-row" key={c.id}>
            <input
              type="checkbox"
              checked={selected.includes(c.id)}
              disabled={pending || busy(c.id)}
              onChange={() => toggle(c.id)}
            />
            <span>
              <strong>
                {c.name} · {c.plainDirectory ? "普通目录" : "Git 仓库"}
                {busy(c.id) ? " · 任务进行中" : ""}
              </strong>
              <small>{c.path}</small>
            </span>
          </label>
        ))}
        {!visible.length && <p>没有匹配的本地目录</p>}
      </div>
      {confirm && (
        <div role="alert">
          <p>
            确认将以下 {selected.length} 个目录移出管理？此操作不会删除文件。
          </p>
          <ul>
            {st.checkouts
              .filter((c) => selected.includes(c.id))
              .map((c) => (
                <li key={c.id}>{c.path}</li>
              ))}
          </ul>
        </div>
      )}
      <div className="form-actions">
        <button disabled={pending} onClick={onClose}>
          关闭
        </button>
        <button
          disabled={pending || !selected.length || selected.some(busy)}
          onClick={() => {
            if (!confirm) {
              setConfirm(true);
              return;
            }
            setPending(true);
            void execute(async () => {
              await api("ForgetCheckouts", selected);
              setSelected([]);
              setConfirm(false);
            }).finally(() => setPending(false));
          }}
        >
          {confirm ? "确认移出管理" : "移出管理"}（{selected.length}）
        </button>
      </div>
    </Modal>
  );
}
