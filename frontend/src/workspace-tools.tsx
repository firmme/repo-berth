import { useState } from "react";
import { api, errorMessage } from "./api";
import { useUI } from "./ui";
import { Modal, Field, DirectoryField } from "./components";
import type { State, Task } from "./types";
import type { Execute } from "./catalog";
const taskNames: Record<string, string> = {
  authorize: "账号授权",
  sync: "同步仓库",
  clone: "克隆仓库",
  scan: "扫描目录",
  fetch: "Fetch",
  pull: "Pull",
  push: "Push",
  commit: "提交",
  branch: "切换分支",
  credential_cleanup: "清理旧凭据",
};
const stateNames: Record<string, string> = {
  queued: "等待执行",
  running: "进行中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
};
const scanIssueNames: Record<string, string> = {
  DUBIOUS_OWNERSHIP: "目录所有者检查失败，请重试扫描",
  NOT_REPOSITORY: "不是有效的 Git 仓库",
  REMOTE_CREDENTIALS: "remote URL 含内嵌凭据，请先移除",
  PERMISSION: "无法读取仓库",
  GIT_FAILED: "Git 无法读取仓库",
  UNREADABLE: "目录不可读取",
};

export function ImportModal({
  execute,
  onClose,
  onImported,
}: {
  execute: Execute;
  onClose: () => void;
  onImported: (id: string, checkoutID?: string) => void;
}) {
  const [path, setPath] = useState("");
  const [scan, setScan] = useState(false);
  const [confirmPlain, setConfirmPlain] = useState(false);
  return (
    <Modal title="导入本地仓库" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void execute(async () => {
            let id: string;
            try {
              id = await api(
                scan
                  ? "ScanDirectory"
                  : confirmPlain
                    ? "ImportPlainDirectory"
                    : "ImportCheckout",
                path,
              );
            } catch (error) {
              if (
                !scan &&
                !confirmPlain &&
                errorMessage(error).includes("NOT_REPOSITORY:")
              ) {
                setConfirmPlain(true);
                return;
              }
              throw error;
            }
            if (!scan) {
              const next = await api("Snapshot");
              onImported(
                next.checkouts.find((c) => c.id === id)?.repositoryId || id,
                id,
              );
            } else useUI.getState().set({ tasksOpen: true });
            onClose();
          });
        }}
      >
        <p className="form-description">
          关联已有目录，文件和现有 Git
          配置会保留。导入后请确认访问账号与提交身份。
        </p>
        <DirectoryField
          value={path}
          onChange={(value) => {
            setPath(value);
            setConfirmPlain(false);
          }}
        />
        {confirmPlain && (
          <div role="alert" className="subtle-note">
            <strong>这个目录不是 Git 仓库，是否继续添加？</strong>
            <p>
              继续后将标记为“普通目录”，仅管理目录和外部打开，不初始化仓库，也不启用
              Git 操作。
            </p>
          </div>
        )}
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={scan}
            onChange={(e) => {
              setScan(e.target.checked);
              setConfirmPlain(false);
            }}
          />
          扫描此目录下的 Git 仓库（最多 2 层）
        </label>
        {scan && (
          <p className="subtle-note">
            支持 Git worktree。忽略 node_modules、vendor 和 .cache；只添加 Git
            仓库，不添加普通目录。检查所选目录、子目录和孙目录，发现仓库后不再进入其内部目录。
          </p>
        )}
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={!path}>
            {confirmPlain ? "继续添加普通目录" : "开始导入"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function GroupModal({
  execute,
  onClose,
}: {
  execute: Execute;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  return (
    <Modal title="新建仓库分组" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void execute(async () => {
            await api("SaveGroup", { id: "", name, members: [] });
            onClose();
          });
        }}
      >
        <Field label="分组名称">
          <input
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：工作项目"
          />
        </Field>
        <div className="form-actions">
          <button className="primary">创建分组</button>
        </div>
      </form>
    </Modal>
  );
}
export function TaskRow({
  task: t,
  st,
  execute,
  onClone,
  onOpenCheckout,
}: {
  task: Task;
  st: State;
  execute: Execute;
  onClone: () => void;
  onOpenCheckout: () => void;
}) {
  const busy = t.state === "running" || t.state === "queued";
  const target =
    st.accounts.find((a) => a.id === t.target)?.login ||
    st.repositories.find((r) => r.id === t.target)?.name ||
    st.checkouts.find((c) => c.id === t.target)?.name ||
    t.target;
  const canRetry = ["sync", "scan", "clone", "credential_cleanup"].includes(
    t.kind,
  );
  return (
    <article className="task-row">
      <div>
        <strong>{taskNames[t.kind] || t.kind}</strong>
        <span className={`task-state ${t.state}`}>
          {stateNames[t.state] || t.state}
        </span>
      </div>
      <p className="ellipsis">{target || "GitHub"}</p>
      {t.cloneRequest && (
        <p className="task-context">
          访问账号：
          {st.accounts.find((a) => a.id === t.cloneRequest!.accountId)?.login ||
            "原账号已移除"}
          <br />
          目标目录：{t.cloneRequest.destination}
        </p>
      )}
      {t.progress && <small>{t.progress}</small>}
      {t.error && (
        <p className="task-error">
          {t.errorCode} · {t.error}
        </p>
      )}
      {t.scanSummary && (
        <details className="task-logs">
          <summary>
            扫描结果：导入/更新 {t.scanSummary.imported}，跳过{" "}
            {t.scanSummary.skipped}
          </summary>
          {t.scanSummary.skipped > 0 && (
            <p className="subtle-note">
              已导入的记录已保留。修复跳过项后可重试，不会重复创建记录。
            </p>
          )}
          {t.scanSummary.issues.length > 0 && (
            <pre>
              {t.scanSummary.issues
                .map(
                  (issue) =>
                    `${issue.path} · ${scanIssueNames[issue.code] || issue.code}`,
                )
                .join("\n")}
            </pre>
          )}
          {t.scanSummary.skipped > t.scanSummary.issues.length && (
            <p className="subtle-note">
              仅列出前 {t.scanSummary.issues.length} 项。
            </p>
          )}
        </details>
      )}
      <details className="task-logs">
        <summary>脱敏日志</summary>
        <pre>
          {t.logs
            ?.map(
              (log) =>
                `${new Date(log.at).toLocaleTimeString()} ${log.message}`,
            )
            .join(String.fromCharCode(10)) ||
            t.error ||
            stateNames[t.state]}
        </pre>
      </details>
      <div className="task-row-footer">
        <time>{new Date(t.startedAt).toLocaleTimeString("zh-CN")}</time>
        {st.checkouts.some((c) => c.id === t.target) && (
          <button onClick={onOpenCheckout}>查看本地副本</button>
        )}
        {busy ? (
          <button onClick={() => void execute(() => api("CancelTask", t.id))}>
            取消
          </button>
        ) : t.canResumeAuthorization ? (
          <div className="actions">
            <button
              onClick={() =>
                void execute(() => api("RecoverAuthorization", t.id, false))
              }
            >
              重试保存授权
            </button>
            <button
              onClick={() =>
                void execute(() => api("RecoverAuthorization", t.id, true))
              }
            >
              仅本次会话
            </button>
          </div>
        ) : t.state !== "succeeded" && canRetry ? (
          <button
            onClick={() => {
              if (t.kind === "clone") onClone();
              else
                void execute(() =>
                  t.kind === "credential_cleanup"
                    ? api("RetryCredentialCleanup")
                    : t.kind === "sync"
                      ? api("SyncRepositories", t.target)
                      : api("ScanDirectory", t.target),
                );
            }}
          >
            重试
          </button>
        ) : null}
      </div>
    </article>
  );
}
