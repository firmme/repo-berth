import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { highlightCode, type LanguageId } from "./highlight";

export function diffStats(text: string) {
  let files = 0,
    insertions = 0,
    deletions = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) files++;
    else if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    else if (line.startsWith("+")) insertions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { files, insertions, deletions };
}

export function diffChangeKind(diff: string) {
  if (/^new file mode /m.test(diff) || /^--- \/dev\/null$/m.test(diff))
    return "added";
  if (/^deleted file mode /m.test(diff) || /^\+\+\+ \/dev\/null$/m.test(diff))
    return "deleted";
  if (/^rename (?:from|to) /m.test(diff)) return "renamed";
  return "modified";
}

type SplitDiffRow = {
  type: "meta" | "hunk" | "context" | "change";
  oldNo?: number;
  newNo?: number;
  oldText?: string;
  newText?: string;
};

function splitDiffRows(text: string): SplitDiffRow[] {
  const lines = text.split("\n");
  const rows: SplitDiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      rows.push({ type: "hunk", oldText: line, newText: line });
      index++;
      continue;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      const oldStart = oldNo;
      const oldLines: string[] = [];
      while (
        index < lines.length &&
        lines[index].startsWith("-") &&
        !lines[index].startsWith("---")
      ) {
        oldLines.push(lines[index].slice(1));
        oldNo++;
        index++;
      }
      const newStart = newNo;
      const newLines: string[] = [];
      while (
        index < lines.length &&
        lines[index].startsWith("+") &&
        !lines[index].startsWith("+++")
      ) {
        newLines.push(lines[index].slice(1));
        newNo++;
        index++;
      }
      const count = Math.max(oldLines.length, newLines.length);
      for (let offset = 0; offset < count; offset++) {
        rows.push({
          type: "change",
          oldNo: oldLines[offset] === undefined ? undefined : oldStart + offset,
          newNo: newLines[offset] === undefined ? undefined : newStart + offset,
          oldText: oldLines[offset],
          newText: newLines[offset],
        });
      }
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      const start = newNo;
      const added: string[] = [];
      while (
        index < lines.length &&
        lines[index].startsWith("+") &&
        !lines[index].startsWith("+++")
      ) {
        added.push(lines[index].slice(1));
        newNo++;
        index++;
      }
      added.forEach((value, offset) =>
        rows.push({
          type: "change",
          newNo: start + offset,
          newText: value,
        }),
      );
      continue;
    }
    if (line.startsWith(" ")) {
      rows.push({
        type: "context",
        oldNo: oldNo++,
        newNo: newNo++,
        oldText: line.slice(1),
        newText: line.slice(1),
      });
      index++;
      continue;
    }
    rows.push({ type: "meta", oldText: line, newText: line });
    index++;
  }
  return rows;
}

export function SplitDiffView({
  text,
  language,
  wordWrap,
}: {
  text: string;
  language: LanguageId;
  wordWrap: boolean;
}) {
  const rows = useMemo(() => splitDiffRows(text), [text]);
  return (
    <div className={`split-diff${wordWrap ? " wrap" : ""}`}>
      <div className="split-diff-body">
        {rows.map((row, index) =>
          row.type === "meta" || row.type === "hunk" ? (
            <div className={`split-diff-full ${row.type}`} key={index}>
              <code
                dangerouslySetInnerHTML={{
                  __html: highlightCode(row.oldText || "", "plaintext"),
                }}
              />
            </div>
          ) : (
            <div className="split-diff-row" key={index}>
              <div
                className={`split-diff-cell ${row.oldText === undefined ? "empty" : ""} ${row.oldText !== undefined && row.oldText !== row.newText ? "removed" : ""}`}
              >
                <span className="split-diff-number">{row.oldNo ?? ""}</span>
                <code
                  dangerouslySetInnerHTML={{
                    __html: highlightCode(row.oldText || "", language),
                  }}
                />
              </div>
              <div
                className={`split-diff-cell ${row.newText === undefined ? "empty" : ""} ${row.newText !== undefined && row.oldText !== row.newText ? "added" : ""}`}
              >
                <span className="split-diff-number">{row.newNo ?? ""}</span>
                <code
                  dangerouslySetInnerHTML={{
                    __html: highlightCode(row.newText || "", language),
                  }}
                />
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

export function DiffViewer({
  text,
  showFileHeaders = true,
  stats,
  fileCount,
  ignored = 0,
  wordWrap = false,
}: {
  text: string;
  showFileHeaders?: boolean;
  stats?: { additions: number; deletions: number };
  fileCount?: number;
  ignored?: number;
  wordWrap?: boolean;
}) {
  const [limit, setLimit] = useState(1500);
  const filteredStats = useMemo(() => diffStats(text), [text]);
  const shownStats = stats ?? {
    additions: filteredStats.insertions,
    deletions: filteredStats.deletions,
  };
  const lines = useMemo(() => {
    let old = 0,
      next = 0;
    let insideHunk = false;
    return text.split("\n").flatMap((line, index) => {
      const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
      if (hunk) {
        insideHunk = true;
        old = Number(hunk[1]);
        next = Number(hunk[2]);
        return [{ line, index, type: "hunk", old: "", next: "" }];
      }
      if (line.startsWith("diff --git ")) {
        insideHunk = false;
        return showFileHeaders
          ? [{ line: line.slice(11), index, type: "file", old: "", next: "" }]
          : [];
      }
      if (
        line.startsWith("index ") ||
        line.startsWith("--- ") ||
        line.startsWith("+++ ")
      )
        return [];
      if (line.startsWith("new file") || line.startsWith("deleted file"))
        return [{ line, index, type: "meta", old: "", next: "" }];
      if (line.startsWith("+"))
        return [{ line, index, type: "add", old: "", next: String(next++) }];
      if (line.startsWith("-"))
        return [{ line, index, type: "delete", old: String(old++), next: "" }];
      if (line.startsWith(" ") && insideHunk)
        return [
          {
            line,
            index,
            type: "context",
            old: String(old++),
            next: String(next++),
          },
        ];
      return line ? [{ line, index, type: "meta", old: "", next: "" }] : [];
    });
  }, [text, showFileHeaders]);
  return (
    <div className={`desktop-diff${wordWrap ? " wrap" : ""}`} role="region" aria-label="文件差异">
      <div className="diff-summary" aria-label="差异统计">
        <span>{fileCount ?? filteredStats.files} 个文件</span>
        <span className="stat-add">+{shownStats.additions}</span>
        <span className="stat-del">−{shownStats.deletions}</span>
        {ignored > 0 && (
          <span className="diff-ignored">已忽略 {ignored} 行换行符差异</span>
        )}
      </div>
      <div className="diff-table">
        {lines.slice(0, limit).map((row) => (
          <div className={`diff-line ${row.type}`} key={row.index}>
            <span className="line-number">{row.old}</span>
            <span className="line-number">{row.next}</span>
            <code>{row.line || " "}</code>
          </div>
        ))}
      </div>
      {lines.length > limit && (
        <div className="diff-more">
          已显示 {limit} / {lines.length} 行。
          <button onClick={() => setLimit((n) => n + 1500)}>
            <ChevronDown size={14} />
            继续显示
          </button>
        </div>
      )}
    </div>
  );
}
























