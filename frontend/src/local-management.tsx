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
  const profile = profiles[0];
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
  hasAccount = false,
) {
  if (checkout.commitName)
    return { name: checkout.commitName, email: checkout.commitEmail || "" };
  if (legacy?.name) return legacy;
  if (hasAccount) return undefined;
  if (st.settings.defaultCommitName)
    return {
      name: st.settings.defaultCommitName,
      email: st.settings.defaultCommitEmail || "",
    };
  return undefined;
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
          使用当前访问账号的提交姓名和邮箱；可在“账号与身份”中修改。
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
  const [selected, setSelected] = useState<Checkout>();
  const [pending, setPending] = useState(false);
  const visible = st.checkouts.filter((c) =>
    (c.name + " " + c.path).toLowerCase().includes(query.toLowerCase()),
  );
  const busy = (id: string) =>
    st.tasks.some(
      (t) => t.target === id && ["running", "queued"].includes(t.state),
    );
  return (
    <Modal title="管理本地目录" onClose={onClose}>
      <p>查看已添加的目录。移出管理会保留磁盘上的文件与 Git 历史。</p>
      <Field label="筛选本地目录">
        <input
          value={query}
          disabled={pending}
          onChange={(e) => setQuery(e.target.value)}
        />
      </Field>
      <div className="local-management-list">
        {visible.map((c) => (
          <div className="local-management-row" key={c.id}>
            <span>
              <strong>
                {c.name} · {c.plainDirectory ? "普通目录" : "Git 仓库"}
                {busy(c.id) ? " · 任务进行中" : ""}
              </strong>
              <small>{c.path}</small>
            </span>
            <button disabled={pending || busy(c.id)} onClick={() => setSelected(c)}>移出管理</button>
          </div>
        ))}
        {!visible.length && <p>没有匹配的本地目录</p>}
      </div>
      {selected && (
        <div role="alert">
          <p>确认将“{selected.name}”移出管理？此操作不会删除文件。</p>
          <p className="path-text">{selected.path}</p>
          <div className="form-actions">
            <button disabled={pending} onClick={() => setSelected(undefined)}>取消</button>
            <button disabled={pending || busy(selected.id)} onClick={() => {
              setPending(true);
              void execute(() => api("ForgetCheckout", selected.id)).then(() => setSelected(undefined)).finally(() => setPending(false));
            }}>确认移出管理</button>
          </div>
        </div>
      )}
      <div className="form-actions">
        <button disabled={pending} onClick={onClose}>
          关闭
        </button>
      </div>
    </Modal>
  );
}
