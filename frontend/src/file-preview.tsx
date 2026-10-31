import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Braces,
  Check,
  FileCode2,
  ExternalLink,
  FolderOpen,
  WrapText,
  FileQuestion,
  FileText,
  Image as ImageIcon,
  Music,
  Pencil,
  Pilcrow,
  Video,
} from "lucide-react";
import { ErrorNotice, Loading } from "./components";
import { LANGUAGES, highlightCode, languageLabel, type LanguageId } from "./highlight";
import type {
  CommitBinaryDiff,
  WorkingFileInfo,
  WorkingFilePreview,
} from "./types";

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
}

export function FileStatusBar({
  info,
  busy,
  language,
  wordWrap,
  readOnly = false,
  onChange,
  onLanguage,
  onToggleWrap,
  onOpenDefault,
  onReveal,
}: {
  info: WorkingFileInfo;
  busy: boolean;
  language: LanguageId;
  wordWrap: boolean;
  readOnly?: boolean;
  onChange?: (encoding: string, lineEnding: string) => void;
  onLanguage?: (language: LanguageId) => void;
  onToggleWrap: () => void;
  onOpenDefault: () => void;
  onReveal: () => void;
}) {
  const [open, setOpen] = useState<
    "encoding" | "lineEnding" | "language" | ""
  >("");
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element).closest(".filebar-format")) setOpen("");
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  if (info.isDir) return null;
  const textEditable =
    info.previewKind === "text" && !info.binary && !info.tooLarge;
  const textFile = info.previewKind === "text";
  const lineEnding =
    info.lineEnding === "LF" ||
    info.lineEnding === "CRLF" ||
    info.lineEnding === "CR"
      ? info.lineEnding
      : "LF";
  if (readOnly) {
    return (
      <div className="desktop-filebar">
        <span className="filebar-path" title={info.path}>
          {info.path}
        </span>
        <span className="filebar-size">{formatBytes(info.size)}</span>
        <span className="filebar-readonly">
          {info.binary ? info.mimeType || "二进制" : info.encoding}
        </span>
        {!info.binary && (
          <span className="filebar-readonly">
            {info.lineEnding === "None" ? "无换行" : info.lineEnding}
          </span>
        )}
        {textFile && (
          <span className="filebar-readonly">{languageLabel(language)}</span>
        )}
        {textFile && (
          <button
            type="button"
            className="filebar-action"
            title="切换自动换行"
            onClick={onToggleWrap}
          >
            <WrapText size={12} />
            {wordWrap ? "不换行" : "换行"}
          </button>
        )}
        <span className="filebar-readonly">历史版本 · 只读</span>
      </div>
    );
  }
  return (
    <div className="desktop-filebar">
      <span className="filebar-path" title={info.path}>
        {info.path}
      </span>
      <span className="filebar-size">{formatBytes(info.size)}</span>
      {textFile && (
        <div className="filebar-format">
          <button
            type="button"
            title="切换代码识别格式（仅影响预览）"
            onClick={() => setOpen(open === "language" ? "" : "language")}
          >
            <Braces size={12} />
            {languageLabel(language)}
          </button>
          {open === "language" && (
            <div className="filebar-menu filebar-language-menu">
              {LANGUAGES.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={item.id === language ? "active" : ""}
                  onClick={() => {
                    setOpen("");
                    onLanguage?.(item.id);
                  }}
                >
                  {item.label}
                  {item.id === language && <Check size={12} />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="filebar-format">
        <button
          type="button"
          disabled={!textEditable || busy}
          title={textEditable ? "切换编码" : "该文件不能切换文本编码"}
          onClick={() => setOpen(open === "encoding" ? "" : "encoding")}
        >
          <FileCode2 size={12} />
          {info.encoding}
        </button>
        {open === "encoding" && (
          <div className="filebar-menu">
            {["UTF-8", "UTF-8 BOM", "UTF-16 LE", "UTF-16 BE"].map((value) => (
              <button
                type="button"
                key={value}
                className={value === info.encoding ? "active" : ""}
                onClick={() => {
                  setOpen("");
                  onChange?.(value, lineEnding);
                }}
              >
                {value}
                {value === info.encoding && <Check size={12} />}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="filebar-format">
        <button
          type="button"
          disabled={!textEditable || busy || info.lineEnding === "None"}
          title={textEditable ? "切换换行符" : "该文件不能切换换行符"}
          onClick={() => setOpen(open === "lineEnding" ? "" : "lineEnding")}
        >
          <Pilcrow size={12} />
          {info.lineEnding === "None" ? "无换行" : info.lineEnding}
        </button>
        {open === "lineEnding" && (
          <div className="filebar-menu">
            {[
              ["LF", "LF（Unix）"],
              ["CRLF", "CRLF（Windows）"],
              ["CR", "CR（旧版 Mac）"],
            ].map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={value === info.lineEnding ? "active" : ""}
                onClick={() => {
                  setOpen("");
                  onChange?.(
                    ["UTF-8", "UTF-8 BOM", "UTF-16 LE", "UTF-16 BE"].includes(
                      info.encoding,
                    )
                      ? info.encoding
                      : "UTF-8",
                    value,
                  );
                }}
              >
                {label}
                {value === info.lineEnding && <Check size={12} />}
              </button>
            ))}
          </div>
        )}
      </div>
      {textFile && (
        <button
          type="button"
          className="filebar-action"
          title="切换自动换行"
          onClick={onToggleWrap}
        >
          <WrapText size={12} />
          {wordWrap ? "不换行" : "换行"}
        </button>
      )}
      {!textEditable && (
        <>
          <button type="button" className="filebar-action" onClick={onOpenDefault}>
            <ExternalLink size={12} />
            默认应用打开
          </button>
          <button type="button" className="filebar-action" onClick={onReveal}>
            <FolderOpen size={12} />
            所在位置
          </button>
        </>
      )}
    </div>
  );
}

export function FilePreviewPane({
  path,
  info,
  preview,
  text,
  language,
  wordWrap,
  loading,
  error,
  onClose,
  onEdit,
  onOpenDefault,
  onReveal,
}: {
  path: string;
  info?: WorkingFileInfo;
  preview?: WorkingFilePreview;
  text?: string;
  language: LanguageId;
  wordWrap: boolean;
  loading: boolean;
  error: string;
  onClose: () => void;
  onEdit: () => void;
  onOpenDefault: () => void;
  onReveal: () => void;
}) {
  const kind = info?.previewKind;
  const needsPreview =
    !!info &&
    ["image", "audio", "video"].includes(info.previewKind) &&
    !info.tooLarge;
  const source = preview
    ? `data:${preview.mimeType};base64,${preview.data}`
    : "";
  return (
    <div className="desktop-preview-pane">
      <div className="desktop-diff-header">
        <button className="desktop-back" aria-label="返回文件列表" onClick={onClose}>
          <ArrowLeft size={16} />
        </button>
        {kind === "image" ? (
          <ImageIcon size={16} />
        ) : kind === "audio" ? (
          <Music size={16} />
        ) : kind === "video" ? (
          <Video size={16} />
        ) : (
          <FileQuestion size={16} />
        )}
        <strong>{path}</strong>
        {info && (
          <>
            <span>{info.encoding}</span>
            <span>{info.lineEnding === "None" ? "无换行" : info.lineEnding}</span>
            <span>{formatBytes(info.size)}</span>
            {info.previewKind === "text" && (
              <span>{languageLabel(language)}</span>
            )}
          </>
        )}
        <span className="editor-actions">
          {info?.editable && (
            <button onClick={onEdit}>
              <Pencil size={14} />
              编辑
            </button>
          )}
          <button onClick={onOpenDefault}>
            <ExternalLink size={14} />
            默认应用
          </button>
          <button onClick={onReveal}>
            <FolderOpen size={14} />
            所在位置
          </button>
        </span>
      </div>
      {loading || (needsPreview && !preview && !error) ? (
        <Loading />
      ) : error ? (
        <div className="desktop-preview-empty">
          <FileQuestion size={42} strokeWidth={1.3} />
          <h2>无法预览此文件</h2>
          <p>{error}</p>
          <div className="form-actions">
            <button onClick={onOpenDefault}>用默认应用打开</button>
            <button onClick={onReveal}>打开文件所在位置</button>
          </div>
        </div>
      ) : !info ? (
        <Loading />
      ) : info.previewKind === "unsupported" || info.tooLarge ? (
        <div className="desktop-preview-empty">
          <FileQuestion size={42} strokeWidth={1.3} />
          <h2>{info.tooLarge ? "文件过大" : "不支持内置预览"}</h2>
          <p>
            {info.tooLarge
              ? "文件超过 32 MiB，请使用默认应用打开。"
              : `${info.mimeType || "二进制文件"}，可以使用默认应用查看。`}
          </p>
          <div className="form-actions">
            <button onClick={onOpenDefault}>用默认应用打开</button>
            <button onClick={onReveal}>打开文件所在位置</button>
          </div>
        </div>
      ) : info.previewKind === "image" && source ? (
        <div className="desktop-preview-media">
          <img src={source} alt={path} />
        </div>
      ) : info.previewKind === "audio" && source ? (
        <div className="desktop-preview-media">
          <Music size={52} strokeWidth={1.2} />
          <audio controls src={source} />
        </div>
      ) : info.previewKind === "video" && source ? (
        <div className="desktop-preview-media">
          <video controls src={source} />
        </div>
      ) : info.previewKind === "text" ? (
        <CodePreview code={text || ""} language={language} wordWrap={wordWrap} />
      ) : (
        <div className="desktop-preview-empty">
          <FileText size={42} strokeWidth={1.3} />
          <h2>文本文件</h2>
          <p>使用内置编辑器查看和修改此文件。</p>
          <div className="form-actions">
            {info.editable && <button onClick={onEdit}>编辑文件</button>}
            <button onClick={onOpenDefault}>用默认应用打开</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CodePreview({
  code,
  language,
  wordWrap,
}: {
  code: string;
  language: LanguageId;
  wordWrap: boolean;
}) {
  const lines = code.split("\n");
  return (
    <div
      className={`desktop-code-preview${wordWrap ? " wrap" : ""}`}
      role="region"
      aria-label="文件内容预览"
    >
      <div className="code-lines">
        {lines.map((line, index) => (
          <div className="code-line" key={index}>
            <span className="code-line-number">{index + 1}</span>
            <span
              className="code-line-text"
              dangerouslySetInnerHTML={{
                __html: highlightCode(line, language),
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function decodeBase64(value: string) {
  const binary = atob(value || "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function CommitMediaPreview({
  info,
  preview,
  loading,
  error,
}: {
  info: WorkingFileInfo;
  preview?: WorkingFilePreview;
  loading: boolean;
  error: string;
}) {
  const source = preview
    ? `data:${preview.mimeType};base64,${preview.data}`
    : "";
  return (
    <div className="desktop-preview-pane">
      <div className="desktop-diff-header">
        {info.previewKind === "image" ? (
          <ImageIcon size={16} />
        ) : info.previewKind === "audio" ? (
          <Music size={16} />
        ) : (
          <Video size={16} />
        )}
        <strong>{info.path}</strong>
        <span>{info.mimeType}</span>
        <span>{formatBytes(info.size)}</span>
      </div>
      {loading ? (
        <Loading />
      ) : info.tooLarge ? (
        <div className="desktop-preview-empty">
          <FileQuestion size={42} strokeWidth={1.3} />
          <h2>文件过大</h2>
          <p>该媒体文件过大，无法在提交历史中内置预览。</p>
        </div>
      ) : error ? (
        <div className="desktop-preview-empty">
          <FileQuestion size={42} strokeWidth={1.3} />
          <h2>无法预览此媒体文件</h2>
          <p>{error}</p>
        </div>
      ) : info.previewKind === "image" && source ? (
        <div className="desktop-preview-media">
          <img src={source} alt={info.path} />
        </div>
      ) : info.previewKind === "audio" && source ? (
        <div className="desktop-preview-media">
          <Music size={52} strokeWidth={1.2} />
          <audio controls src={source} />
        </div>
      ) : info.previewKind === "video" && source ? (
        <div className="desktop-preview-media">
          <video controls src={source} />
        </div>
      ) : (
        <Loading />
      )}
    </div>
  );
}

export function BinaryDiffPane({
  info,
  diff,
  loading,
  error,
}: {
  info: WorkingFileInfo;
  diff?: CommitBinaryDiff;
  loading: boolean;
  error: string;
}) {
  const oldBytes = decodeBase64(diff?.oldData || "");
  const newBytes = decodeBase64(diff?.newData || "");
  const displayBytes = newBytes.length ? newBytes : oldBytes;
  const rows: ReactNode[] = [];
  const limit = Math.min(displayBytes.length, 16 << 10);
  for (let offset = 0; offset < limit; offset += 16) {
    const row = displayBytes.slice(offset, Math.min(limit, offset + 16));
    const hex: ReactNode[] = [];
    const ascii: ReactNode[] = [];
    row.forEach((byte, index) => {
      const position = offset + index;
      const changed =
        !diff?.oldExists ||
        !diff?.newExists ||
        position >= oldBytes.length ||
        oldBytes[position] !== byte;
      const text = byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ".";
      hex.push(
        <span
          key={`h:${position}`}
          className={changed ? "binary-byte changed" : "binary-byte"}
        >
          {byte.toString(16).padStart(2, "0")}
        </span>,
      );
      ascii.push(
        <span
          key={`a:${position}`}
          className={changed ? "binary-byte changed" : "binary-byte"}
        >
          {text}
        </span>,
      );
    });
    rows.push(
      <div className="binary-hex-row" key={offset}>
        <span className="binary-offset">
          {offset.toString(16).padStart(8, "0")}
        </span>
        <span className="binary-hex">{hex}</span>
        <span className="binary-ascii">{ascii}</span>
      </div>,
    );
  }
  return (
    <div className="binary-diff-pane">
      <div className="binary-diff-summary">
        <FileQuestion size={16} />
        <strong>{info.path}</strong>
        <span>{info.mimeType || "application/octet-stream"}</span>
        <span>
          {diff
            ? `${diff.oldExists ? formatBytes(diff.oldSize) : "不存在"} → ${
                diff.newExists ? formatBytes(diff.newSize) : "已删除"
              }`
            : formatBytes(info.size)}
        </span>
        {diff && (
          <span className={diff.changedBytes ? "stat-del" : ""}>
            {diff.changedBytes
              ? `${diff.changedBytes} 个字节不同`
              : diff.oldHash && diff.oldHash === diff.newHash
                ? "文件内容相同"
                : "前 64 KiB 无差异"}
          </span>
        )}
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorNotice message={error} />
      ) : diff ? (
        <>
          <div className="binary-meta">
            <span>
              旧:{diff.oldExists ? diff.oldHash.slice(0, 12) : "不存在"}
            </span>
            <span>
              新:{diff.newExists ? diff.newHash.slice(0, 12) : "已删除"}
            </span>
            {diff.truncated && <span>差异统计基于前 64 KiB</span>}
            <span>十六进制预览前 16 KiB</span>
            {diff.firstDifference >= 0 && (
              <span>首个差异位于 0x{diff.firstDifference.toString(16)}</span>
            )}
          </div>
          <div className="binary-hex-view">
            {rows.length ? rows : <p className="desktop-list-empty">文件为空</p>}
          </div>
        </>
      ) : (
        <Loading />
      )}
    </div>
  );
}

