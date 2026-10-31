import { useEffect, useRef, useState, useId, type ReactNode } from "react";
import { X, FolderOpen, LoaderCircle, AlertCircle } from "lucide-react";
import { api, errorMessage } from "./api";
import type { Account } from "./types";

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header className="modal-header">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="关闭">
          <X size={18} />
        </button>
      </header>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function DirectoryField({
  value,
  onChange,
  label = "目录",
  required = true,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  required?: boolean;
}) {
  const [error, setError] = useState("");
  return (
    <Field label={label}>
      <span className="joined">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
        />
        <button
          type="button"
          aria-label="选择目录"
          onClick={() =>
            void (async () => {
              try {
                setError("");
                const path = await api("PickDirectory");
                if (path) onChange(path);
              } catch (e) {
                setError(errorMessage(e));
              }
            })()
          }
        >
          <FolderOpen size={16} />
        </button>
      </span>
      {error && <small role="alert">{error}</small>}
    </Field>
  );
}
export function AccountAvatar({
  account,
  size = 28,
}: {
  account: Account;
  size?: number;
}) {
  const [failedURL, setFailedURL] = useState("");
  const needsAuthorization = account.status === "auth_required";
  const source = /^https:\/\/avatars\.githubusercontent\.com\//i.test(
    account.avatar || "",
  )
    ? account.avatar
    : "";
  return (
    <span
      className={`account-avatar ${needsAuthorization ? "auth-warning" : ""}`}
      title={needsAuthorization ? "需要重新授权" : undefined}
      style={{
        width: size,
        height: size,
        borderColor: account.color,
        color: account.color,
      }}
    >
      {source && failedURL !== source ? (
        <img
          src={source}
          alt={`${account.login} 的头像`}
          width={size}
          height={size}
          referrerPolicy="no-referrer"
          onError={() => setFailedURL(source)}
        />
      ) : (
        <span aria-hidden="true">
          {account.login.slice(0, 2).toUpperCase()}
        </span>
      )}
      {needsAuthorization && (
        <span
          className="account-auth-warning"
          aria-label="需要重新授权"
          role="status"
        >
          !
        </span>
      )}
    </span>
  );
}
export function AccountMark({ account }: { account: Account }) {
  return (
    <span
      className="account-mark"
      style={{ backgroundColor: account.color + "18", color: account.color }}
    >
      <AccountAvatar account={account} size={34} />
    </span>
  );
}
export function ErrorNotice({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div className="error-notice" role="alert">
      <AlertCircle size={16} />
      <span>{message}</span>
      {onDismiss && (
        <button
          aria-label="关闭提示"
          className="icon-button"
          onClick={onDismiss}
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading">
      <LoaderCircle className="spin" size={18} /> 正在读取…
    </div>
  );
}
export function Stamp({ date }: { date: string }) {
  if (!date) return <span>尚未同步</span>;
  return (
    <time dateTime={date}>
      {new Date(date).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })}
    </time>
  );
}

const repositoryGradients = [
  { from: "#e0f2fe", to: "#bae6fd", ink: "#0c4a6e" },
  { from: "#dbeafe", to: "#bfdbfe", ink: "#1e3a8a" },
  { from: "#ede9fe", to: "#ddd6fe", ink: "#4c1d95" },
  { from: "#fce7f3", to: "#fbcfe8", ink: "#831843" },
  { from: "#ffe4e6", to: "#fecdd3", ink: "#881337" },
  { from: "#fef3c7", to: "#fde68a", ink: "#78350f" },
  { from: "#dcfce7", to: "#bbf7d0", ink: "#14532d" },
  { from: "#ccfbf1", to: "#99f6e4", ink: "#134e4a" },
  { from: "#ecfccb", to: "#d9f99d", ink: "#365314" },
  { from: "#ffedd5", to: "#fed7aa", ink: "#7c2d12" },
];

export function repositoryMark(name: string) {
  const chars = Array.from((name || "").trim());
  let hash = 0;
  for (const char of chars.length ? chars : ["?"]) {
    hash = (hash * 31 + (char.codePointAt(0) || 0)) >>> 0;
  }
  const palette = repositoryGradients[hash % repositoryGradients.length];
  return {
    ...palette,
    initial: (chars[0] || "?").toUpperCase(),
  };
}

export function RepositoryMark({
  name,
  size = 30,
  className = "",
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const mark = repositoryMark(name);
  return (
    <span
      aria-hidden="true"
      className={`repo-mark ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.44),
        background: `linear-gradient(135deg, ${mark.from}, ${mark.to})`,
        color: mark.ink,
      }}
    >
      {mark.initial}
    </span>
  );
}
