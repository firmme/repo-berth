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
  const source = /^https:\/\/avatars\.githubusercontent\.com\//i.test(
    account.avatar || "",
  )
    ? account.avatar
    : "";
  return (
    <span
      className="account-avatar"
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
