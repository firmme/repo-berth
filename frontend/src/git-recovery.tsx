import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "./api";
import { ErrorNotice, Loading, Modal } from "./components";
import type { Checkout, RecoveryPlan, RecoveryRequest } from "./types";

export function GitRecoveryModal({ checkout, initialRequest, unsavedEditor, onApplied, onClose }: {
  checkout: Checkout;
  initialRequest: RecoveryRequest;
  unsavedEditor?: string;
  onApplied: (plan: RecoveryPlan, request: RecoveryRequest) => Promise<void>;
  onClose: () => void;
}) {
  const [request, setRequest] = useState(initialRequest);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const preview = useQuery({ queryKey: ["git-recovery", checkout.id, request], queryFn: () => api("PreviewGitRecovery", checkout.id, request), retry: false, refetchOnWindowFocus: false, staleTime: 0 });
  const plan = preview.data;
  const destructive = request.kind === "discard" || request.mode === "hard";
  const closesEditor = !!unsavedEditor && destructive && (request.kind === "reset" || request.all || plan?.files.some((f) => f.path === unsavedEditor));
  useEffect(() => { setConfirmed(false); }, [plan?.fingerprint, request]);
  const apply = async () => {
    if (busy || !plan || preview.isError || preview.isFetching || (destructive && !confirmed)) return;
    setBusy(true); setError("");
    try {
      await api("ApplyGitRecovery", checkout.id, request, plan.fingerprint);
      await onApplied(plan, request);
      onClose();
    } catch (err) {
      setError(errorMessage(err)); setConfirmed(false);
      await preview.refetch();
    } finally { setBusy(false); }
  };
  return <Modal title={request.kind === "reset" ? "重置当前分支到此提交" : request.all ? "丢弃全部未提交修改" : "丢弃所选文件的修改"} onClose={onClose} closeDisabled={busy}>
    <p><strong>{checkout.name}</strong> · {plan?.branch || "当前工作区"}</p>
    {request.kind === "reset" ? <>
      <p>目标提交：<code>{request.target.slice(0, 12)}</code>。此操作只改变本地仓库，远程分支保持原样。</p>
      <fieldset className="recovery-options" disabled={busy}>
        <legend>重置方式</legend>
        {([
          ["soft", "保留修改和暂存（Soft）", "只移动分支指向。"],
          ["mixed", "保留文件，清空暂存（Mixed）", "将差异留在工作区。"],
          ["hard", "丢弃修改（Hard）", "将已跟踪文件和暂存区恢复到目标提交。"],
        ] as const).map(([mode, label, description]) => <label key={mode}>
          <input type="radio" name="reset-mode" value={mode} checked={request.mode === mode} onChange={() => { setError(""); setRequest({ ...request, mode }); }} />
          <span>{label}<small>{description}</small></span>
        </label>)}
      </fieldset>
      {plan && <p>当前分支有 {plan.commits} 个提交不在目标提交的历史中。</p>}
    </> : <>
      <p>{plan && !plan.head ? "仓库尚无提交，丢弃列出的新增文件会将其删除。" : "列出的文件将恢复为最近一次提交的版本，同时丢弃其已暂存和未暂存修改。新增的已暂存文件会被删除。"}</p>
      {!request.all && <p>范围：{request.paths.join("、")}</p>}
      <label className="recovery-check"><input type="checkbox" checked={request.includeUntracked} disabled={busy} onChange={(e) => { setError(""); setRequest({ ...request, includeUntracked: e.target.checked }); }} />同时删除范围内未跟踪的新文件</label>
      <p className="muted">被 .gitignore 等规则忽略的文件保持原样。</p>
    </>}
    {preview.isFetching ? <Loading /> : preview.error ? <ErrorNotice message={errorMessage(preview.error)} /> : plan && <>
      <p>{plan.files.length} 个{request.kind === "reset" ? "相关" : "受影响"}文件</p>
      <ul className="recovery-files" aria-label="撤销操作文件预览">{plan.files.map((f) => <li key={f.path}><code>{f.path}</code><span>{f.action === "delete" ? "删除" : f.action === "restore" ? "还原" : "相关变更"}</span></li>)}</ul>
      {request.kind === "discard" && !plan.files.length && <p>当前范围没有可丢弃的修改。</p>}
    </>}
    {closesEditor && <ErrorNotice message={`编辑器中 ${unsavedEditor} 的未保存内容也会关闭并丢弃。`} />}
    {destructive && <label className="recovery-check"><input type="checkbox" checked={confirmed} disabled={busy || preview.isFetching || !!preview.error} onChange={(e) => setConfirmed(e.target.checked)} />我确认丢弃上述修改，未提交内容无法通过 Git 历史恢复</label>}
    {error && <ErrorNotice message={error} />}
    <div className="form-actions">
      <button disabled={busy} onClick={onClose}>取消</button>
      <button disabled={busy || preview.isFetching} onClick={() => { setError(""); setConfirmed(false); void preview.refetch(); }}>刷新预览</button>
      <button className={destructive ? "danger" : "primary"} disabled={busy || !plan || !!preview.error || preview.isFetching || (destructive && !confirmed) || (request.kind === "discard" && !plan.files.length)} onClick={() => void apply()}>{busy ? "正在执行…" : request.kind === "reset" ? "确认重置" : "确认丢弃修改"}</button>
    </div>
  </Modal>;
}
