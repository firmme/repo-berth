import { useEffect, useMemo, useRef, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  GitBranch,
  RefreshCw,
  ArrowDown,
  ArrowUp,
  FolderGit2,
  FolderOpen,
  Code2,
  ExternalLink,
  Search,
  UsersRound,
  Plus,
  Check,
  X,
  Settings2,
  GitCommitHorizontal,
  Columns2,
  Clock3,
  Star,
  Activity,
  FileText,
  ArrowLeft,
  Minus,
  Square,
  Github,
  Folder,
  Files,
  FilePlus2,
  Pencil,
  EyeOff,
  Trash2,
  Copy,
  Scissors,
  ClipboardPaste,
  FolderPlus,
  Terminal,
  Image as ImageIcon,
  Music,
  Video,
  FileQuestion,
  Eye,
  WrapText,
  Save,
} from "lucide-react";
import { api, errorMessage } from "./api";
import { useUI } from "./ui";
import { effectiveCommitIdentity } from "./local-management";
import type {
  Branch,
  Checkout,
  Commit,
  CommitBinaryDiff,
  FileStatus,
  GitStatus,
  LineEndingRisk,
  State,
  WorkingFileInfo,
  WorkingFilePreview,
} from "./types";
import type { Execute, Row } from "./catalog";
import {
  AccountAvatar,
  ActionRow,
  ErrorNotice,
  Field,
  Loading,
  Modal,
} from "./components";
import { DiffViewer, SplitDiffView, diffChangeKind, diffStats } from "./diff-view";
import {
  BinaryDiffPane,
  CommitMediaPreview,
  FilePreviewPane,
  FileStatusBar,
} from "./file-preview";
import {
  absoluteWorkingPath,
  buildFileTree,
  fileStats,
  findTreeNode,
  flattenTree,
  folderPaths,
  fileStatusKind,
  folderStatusKind,
  hasStaged,
  hasUnstaged,
  parentPath,
  treeStats,
  type FileTreeNode,
} from "./file-tree";
import { BranchTreeView } from "./branch-tree";
import { commitPills } from "./commit-labels";
import { FileContextMenu } from "./file-context-menu";
import { detectLanguage, highlightCode, type LanguageId } from "./highlight";

export function Worktree({
  checkout: c,
  state: st,
  row,
  status,
  statusError,
  verifying,
  remote,
  accountID,
  busy,
  tab,
  setTab,
  wordWrap,
  setWordWrap,
  execute,
  configure,
  accountSettings,
  openRepository,
}: {
  checkout: Checkout;
  state: State;
  row: Row;
  status?: GitStatus;
  statusError: string;
  verifying: boolean;
  remote: string;
  accountID: string;
  busy: boolean;
  tab: "changes" | "history";
  setTab: (tab: "changes" | "history") => void;
  wordWrap: boolean;
  setWordWrap: (value: (current: boolean) => boolean) => void;
  execute: Execute;
  configure: () => void;
  accountSettings: () => void;
  openRepository: () => void;
}) {
  const client = useQueryClient();
  const [filter, setFilter] = useState(""),
    [fileView, setFileView] = useState<"changes" | "all">("changes"),
    [selected, setSelected] = useState<{ path: string; staged: boolean }>(),
    [commitHash, setCommitHash] = useState(""),
    [historyFile, setHistoryFile] = useState(""),
    [diffMode, setDiffMode] = useState<"unified" | "split">("unified"),
    [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set()),
    [sending, setSending] = useState(false),
    [stageOverrides, setStageOverrides] = useState<Record<string, boolean>>({}),
    [stagingPaths, setStagingPaths] = useState<Set<string>>(new Set()),
    [stageError, setStageError] = useState(""),
    [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set()),
    [menu, setMenu] = useState<{
      x: number;
      y: number;
      node: FileTreeNode;
    }>(),
    [editing, setEditing] = useState(""),
    [editorText, setEditorText] = useState(""),
    [editorOriginal, setEditorOriginal] = useState(""),
    [editorLoading, setEditorLoading] = useState(false),
    [editorSaving, setEditorSaving] = useState(false),
    [editorError, setEditorError] = useState(""),
    [cursorLine, setCursorLine] = useState(1),
    [newFileOpen, setNewFileOpen] = useState(false),
    [newFileName, setNewFileName] = useState(""),
    [newFileInitial, setNewFileInitial] = useState(""),
    [newFileError, setNewFileError] = useState(""),
    [newItemKind, setNewItemKind] = useState<"file" | "dir">("file"),
    [treeSelected, setTreeSelected] = useState(""),
    [clipboard, setClipboard] = useState<{ path: string; cut: boolean }>(),
    [previewPath, setPreviewPath] = useState(""),
    [renameTarget, setRenameTarget] = useState<FileTreeNode>(),
    [renameName, setRenameName] = useState(""),
    [renameError, setRenameError] = useState(""),
    [fileBarSlot, setFileBarSlot] = useState<HTMLElement | null>(null),
    [formatBusy, setFormatBusy] = useState(false),
    [languageOverrides, setLanguageOverrides] = useState<
      Record<string, LanguageId>
    >({}),
    [lineEndingRisks, setLineEndingRisks] = useState<LineEndingRisk[]>(),
    [lineEndingBusy, setLineEndingBusy] = useState(false),
    [lineEndingError, setLineEndingError] = useState("");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const editorHighlightRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    setFileBarSlot(document.getElementById("desktop-filebar-slot"));
  }, []);
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element).closest(".desktop-context-menu"))
        setMenu(undefined);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(undefined);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
    };
  }, [menu]);
  const draft = useUI((s) => s.commitDrafts[c.id] || ""),
    submission = useUI((s) => s.commitSubmissions[c.id]);
  const split = draft.indexOf("\n");
  const summary = split < 0 ? draft : draft.slice(0, split);
  const description =
    split < 0 ? "" : draft.slice(split + 1).replace(/^\n/, "");
  const writeDraft = (title: string, body: string) =>
    useUI.getState().setCommitDraft(c.id, title + (body ? "\n\n" + body : ""));
  const files = status?.files || [];
  const allFiles = useQuery({
    queryKey: ["git", "files", c.id],
    queryFn: () => api("GitFiles", c.id),
    enabled: tab === "changes" && fileView === "all",
  });
  const staged = files.filter(hasStaged);
  const isChanged = (f: FileStatus) => hasStaged(f) || hasUnstaged(f);
  const statusByPath = useMemo(
    () => new Map(files.map((file) => [file.path, file])),
    [files],
  );
  const sourceFiles = useMemo(() => {
    if (fileView === "changes") return files;
    return (allFiles.data || []).map((entry) => {
      const changed = statusByPath.get(entry.path);
      return (
        changed || {
          path: entry.path,
          originalPath: "",
          index: " ",
          worktree: " ",
          tracked: entry.tracked,
          ignored: entry.ignored,
          isDir: entry.directory,
        }
      );
    });
  }, [allFiles.data, fileView, files, statusByPath]);
  const fullyStaged = (f: FileStatus) => stageOverrides[f.path] ?? (hasStaged(f) && !hasUnstaged(f));
  const stageFiles = async (targets: FileStatus[], next: boolean) => {
    if (!targets.length) return;
    setStageError("");
    setStageOverrides((old) => Object.fromEntries([...Object.entries(old), ...targets.map((f) => [f.path, next])]));
    setStagingPaths((old) => new Set([...old, ...targets.map((f) => f.path)]));
    try {
      if (targets.length === 1) await api("StageFile", c.id, targets[0].path, next);
      else await api("StageFiles", c.id, targets.map((f) => f.path), next);
      await client.invalidateQueries({ queryKey: ["git", "status", c.id] });
      await client.invalidateQueries({ queryKey: ["git", "diff", c.id] });
    } catch (e) {
      setStageError(errorMessage(e));
      await client.invalidateQueries({ queryKey: ["git", "status", c.id] });
    } finally {
      setStageOverrides((old) => { const nextValues = { ...old }; for (const f of targets) delete nextValues[f.path]; return nextValues; });
      setStagingPaths((old) => { const nextValues = new Set(old); for (const f of targets) nextValues.delete(f.path); return nextValues; });
    }
  };
  const filtered = sourceFiles.filter((f) =>
    f.path.toLowerCase().includes(filter.toLowerCase()),
  );
  const tree = useMemo(
    () =>
      buildFileTree(
        filtered,
        fileView === "all" ? { name: c.name, path: "" } : undefined,
      ),
    [filtered, fileView, c.name],
  );
  const selectedNode = useMemo(
    () => findTreeNode(tree, treeSelected),
    [tree, treeSelected],
  );
  const createBase = selectedNode
    ? selectedNode.isDir
      ? selectedNode.path
      : parentPath(selectedNode.path)
    : "";
  const allFolderPaths = useMemo(() => folderPaths(tree), [tree]);
  const initializedFoldersKey = useRef("");
  useEffect(() => {
    const key = `${c.id}:${fileView}`;
    if (initializedFoldersKey.current === key || !tree.length) return;
    initializedFoldersKey.current = key;
    if (fileView === "changes") {
      setExpandedFolders(new Set(folderPaths(tree)));
      return;
    }
    const next = new Set<string>();
    if (tree.length === 1 && tree[0].path === "") {
      next.add(tree[0].path);
      for (const child of tree[0].children)
        if (child.isDir) next.add(child.path);
    } else {
      for (const node of tree) if (node.isDir) next.add(node.path);
    }
    setExpandedFolders(next);
  }, [tree, c.id, fileView]);
  const expandAllTree = () => setExpandedFolders(new Set(allFolderPaths));
  const collapseAllTree = () => setExpandedFolders(new Set());
  const confirmDiscard = () =>
    !editing ||
    editorText === editorOriginal ||
    window.confirm("未保存的修改将丢失，继续？");
  const selectFile = (f: FileStatus) => {
    if (!confirmDiscard()) return;
    setEditing("");
    setPreviewPath("");
    setTreeSelected(f.path);
    setSelected({
      path: f.path,
      staged: hasStaged(f) && !hasUnstaged(f),
    });
  };
  const closeEditor = () => {
    if (!confirmDiscard()) return;
    setEditing("");
    setEditorError("");
  };
  const openPreview = (path: string) => {
    if (!confirmDiscard()) return;
    setEditing("");
    setSelected(undefined);
    setPreviewPath(path);
    setTreeSelected(path);
  };
  const activateFile = (item: FileStatus) => {
    setTreeSelected(item.path);
    if (isChanged(item)) {
      selectFile(item);
      return;
    }
    openPreview(item.path);
  };
  const openEditor = async (path: string) => {
    setMenu(undefined);
    setEditorError("");
    if (editing === path) return;
    if (!confirmDiscard()) return;
    setEditorLoading(true);
    try {
      const content = await api("GitFileContent", c.id, path);
      setEditorText(content);
      setEditorOriginal(content);
      setCursorLine(1);
      setEditing(path);
      setPreviewPath("");
      setTreeSelected(path);
      const target = files.find((item) => item.path === path);
      if (target)
        setSelected({
          path,
          staged: hasStaged(target) && !hasUnstaged(target),
        });
    } catch (e) {
      setEditorText("");
      setEditorOriginal("");
      setEditorError(errorMessage(e));
      if (errorMessage(e).includes("二进制")) {
        setEditing("");
        openPreview(path);
      } else {
        setEditing(path);
      }
    } finally {
      setEditorLoading(false);
    }
  };
  const saveEditor = async () => {
    if (!editing) return;
    setEditorSaving(true);
    setEditorError("");
    try {
      await api("SaveWorkingFile", c.id, editing, editorText);
      setEditorOriginal(editorText);
      await client.invalidateQueries({ queryKey: ["git", "status", c.id] });
      await client.invalidateQueries({ queryKey: ["git", "diff", c.id] });
    } catch (e) {
      setEditorError(errorMessage(e));
    } finally {
      setEditorSaving(false);
    }
  };
  const refreshWorkingTree = async () => {
    await client.invalidateQueries({ queryKey: ["git", "status", c.id] });
    await client.invalidateQueries({ queryKey: ["git", "files", c.id] });
    await client.invalidateQueries({ queryKey: ["git", "diff", c.id] });
    await client.invalidateQueries({ queryKey: ["git", "file-info", c.id] });
  };
  const startCreate = (base: string, kind: "file" | "dir") => {
    setMenu(undefined);
    setNewItemKind(kind);
    const initial = base ? base.replace(/\/+$/, "") + "/" : "";
    setNewFileName(initial);
    setNewFileInitial(initial);
    setNewFileError("");
    setNewFileOpen(true);
  };
  const createFile = async () => {
    const raw = newFileName.trim().replace(/^[\\/]+/, "");
    if (!raw) return;
    if (newItemKind === "file" && newFileInitial && raw === newFileInitial) {
      setNewFileError("请输入文件名，或在末尾添加 / 创建目录。");
      return;
    }
    const directory =
      newItemKind === "dir" ||
      (/[\\/]$/.test(raw) && raw !== newFileInitial);
    const name = raw.replace(/[\\/]+$/, "").replace(/\\/g, "/");
    setNewFileError("");
    try {
      if (directory)
        await api("CreateWorkingDirectory", c.id, name);
      else await api("CreateWorkingFile", c.id, name);
      setNewFileOpen(false);
      setNewFileName("");
      setNewFileInitial("");
      await refreshWorkingTree();
      setTreeSelected(name);
      if (!directory) await openEditor(name);
      else {
        setExpandedFolders((old) => {
          const next = new Set(old);
          const parts = name.split("/");
          next.add("");
          for (let index = 1; index < parts.length; index++)
            next.add(parts.slice(0, index).join("/"));
          return next;
        });
      }
    } catch (e) {
      setNewFileError(errorMessage(e));
    }
  };
  const renameEntry = async () => {
    if (!renameTarget) return;
    setRenameError("");
    try {
      await api("RenameWorkingPath", c.id, renameTarget.path, renameName);
      const parent = renameTarget.path.includes("/")
        ? renameTarget.path.slice(0, renameTarget.path.lastIndexOf("/"))
        : "";
      const nextPath = parent ? `${parent}/${renameName}` : renameName;
      if (treeSelected === renameTarget.path) setTreeSelected(nextPath);
      if (previewPath === renameTarget.path) setPreviewPath(nextPath);
      if (editing === renameTarget.path) setEditing(nextPath);
      setSelected((old) =>
        old?.path === renameTarget.path ? { ...old, path: nextPath } : old,
      );
      setRenameTarget(undefined);
      await refreshWorkingTree();
    } catch (e) {
      setRenameError(errorMessage(e));
    }
  };
  const removeEntry = (node: FileTreeNode) => {
    if (!window.confirm(`确定删除 ${node.path}？此操作不可撤销。`)) return;
    setMenu(undefined);
    const affected = (path: string) =>
      path === node.path || (node.isDir && path.startsWith(node.path + "/"));
    void execute(async () => {
      await api("DeleteWorkingPath", c.id, node.path);
      if (affected(treeSelected)) setTreeSelected("");
      if (affected(previewPath)) setPreviewPath("");
      if (affected(editing)) setEditing("");
      if (selected && affected(selected.path)) setSelected(undefined);
      await refreshWorkingTree();
    });
  };
  const copyEntry = (node: FileTreeNode, cut: boolean) => {
    setClipboard({ path: node.path, cut });
    setMenu(undefined);
  };
  const pasteInto = (node: FileTreeNode) => {
    if (!clipboard) return;
    const destination = node.isDir
      ? node.path
      : node.path.includes("/")
        ? node.path.slice(0, node.path.lastIndexOf("/"))
        : "";
    setMenu(undefined);
    void execute(async () => {
      await api("CopyWorkingPath", c.id, clipboard.path, destination, clipboard.cut);
      if (clipboard.cut) setClipboard(undefined);
      await refreshWorkingTree();
    });
  };
  const openMenu = (event: ReactMouseEvent, node: FileTreeNode) => {
    event.preventDefault();
    event.stopPropagation();
    setTreeSelected(node.path);
    setMenu({
      x: Math.min(event.clientX, Math.max(8, window.innerWidth - 220)),
      y: Math.min(event.clientY, Math.max(8, window.innerHeight - 540)),
      node,
    });
  };
  const stageNode = (node: FileTreeNode, next: boolean) => {
    setMenu(undefined);
    void stageFiles(
      (node.file ? [node.file] : flattenTree(node)).filter(isChanged),
      next,
    );
  };
  const nodeStaged = (node: FileTreeNode) => {
    const targets = (node.file ? [node.file] : flattenTree(node)).filter(
      isChanged,
    );
    return targets.length > 0 && targets.every(fullyStaged);
  };
  const ignoreNode = (node: FileTreeNode) => {
    setMenu(undefined);
    void execute(async () => {
      await api("AddToGitignore", c.id, node.path, node.isDir);
      await client.invalidateQueries({ queryKey: ["git", "status", c.id] });
      await client.invalidateQueries({ queryKey: ["git", "files", c.id] });
    });
  };
  const forceTrackNode = (node: FileTreeNode) => {
    setMenu(undefined);
    void execute(async () => {
      await api("ForceTrackFile", c.id, node.path);
      await client.invalidateQueries({ queryKey: ["git", "status", c.id] });
      await client.invalidateQueries({ queryKey: ["git", "files", c.id] });
    });
  };
  const untrackNode = (node: FileTreeNode) => {
    setMenu(undefined);
    if (
      !window.confirm(
        `${node.isDir ? "递归" : ""}从 Git 索引移除 ${node.path}？磁盘文件会保留。`,
      )
    )
      return;
    void execute(async () => {
      await api("UntrackFile", c.id, node.path, node.isDir);
      await client.invalidateQueries({ queryKey: ["git", "status", c.id] });
      await client.invalidateQueries({ queryKey: ["git", "files", c.id] });
    });
  };
  const updateCursorLine = () => {
    const position = editorRef.current?.selectionStart ?? 0;
    setCursorLine(editorText.slice(0, position).split("\n").length);
  };
  const renderTree = (nodes: FileTreeNode[], depth: number): ReactNode[] =>
    nodes.flatMap((node) => {
      if (node.isDir) {
        const expanded = !!filter || expandedFolders.has(node.path);
        const stats = treeStats(node);
        return [
          <div
            className={`tree-folder status-${folderStatusKind(node)} ${treeSelected === node.path ? "selected" : ""}`}
            key={`folder:${node.path}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => {
              setTreeSelected(node.path);
              setExpandedFolders((old) => {
                const next = new Set(old);
                if (next.has(node.path)) next.delete(node.path);
                else next.add(node.path);
                return next;
              });
            }}
            onContextMenu={(event) => openMenu(event, node)}
          >
            {expanded ? (
              <ChevronDown size={13} />
            ) : (
              <ChevronRight size={13} />
            )}
            {expanded ? <FolderOpen size={14} /> : <Folder size={14} />}
            <span className="tree-name" title={node.path}>
              {node.name}
            </span>
            {stats.additions > 0 && (
              <span className="tree-stat stat-add">+{stats.additions}</span>
            )}
            {stats.deletions > 0 && (
              <span className="tree-stat stat-del">−{stats.deletions}</span>
            )}
          </div>,
          ...(expanded ? renderTree(node.children, depth + 1) : []),
        ];
      }
      const item = node.file!;
      const stats = fileStats(item);
      const changed = isChanged(item);
      return [
        <div
          className={`desktop-file-row tree-file status-${fileStatusKind(item)} ${file?.path === item.path ? "selected" : ""} ${treeSelected === item.path ? "tree-selected" : ""}`}
          key={`file:${item.path}`}
          style={{ paddingLeft: 6 + depth * 14 }}
          onContextMenu={(event) => openMenu(event, node)}
        >
          {changed ? (
            <label
              className="file-stage-toggle"
              title={
                fullyStaged(item)
                  ? `取消暂存 ${item.path}`
                  : `暂存 ${item.path}`
              }
            >
              <input
                aria-label={`${fullyStaged(item) ? "取消暂存" : "暂存"} ${item.path}`}
                type="checkbox"
                checked={fullyStaged(item)}
                disabled={
                  busy ||
                  !!statusError ||
                  !status ||
                  stagingPaths.has(item.path)
                }
                onChange={() => stage(item)}
              />
            </label>
          ) : (
            <span className="file-stage-spacer" />
          )}
          <button
            title={item.path}
            className="file-name"
            onClick={() => {
              if (fileView === "all" && !changed)
                void activateFile(item);
              else selectFile(item);
            }}
          >
            <FileText size={13} />
            {item.originalPath ? (
              <span
                className="file-rename"
                title={`${item.originalPath} → ${item.path}`}
              >
                <span className="file-rename-old">{item.originalPath}</span>
                <span className="file-rename-arrow">→</span>
                <span>{node.name}</span>
              </span>
            ) : (
              <span>{node.name}</span>
            )}
          </button>
          <span className="file-line-stats">
            {stats.additions > 0 && (
              <span className="stat-add">+{stats.additions}</span>
            )}
            {stats.deletions > 0 && (
              <span className="stat-del">−{stats.deletions}</span>
            )}
          </span>
          {(changed || item.ignored) && (
            <code
              className={
                item.ignored
                  ? "ignored"
                  : item.index === "?" || item.index === "A"
                    ? "added"
                    : item.index === "D" || item.worktree === "D"
                      ? "removed"
                      : ""
              }
              title={
                item.ignored
                  ? "已忽略"
                  : fileStatusKind(item) === "untracked"
                    ? "未跟踪"
                    : fileStatusKind(item) === "renamed"
                      ? "重命名"
                      : fileStatusKind(item) === "added"
                        ? "新增"
                        : fileStatusKind(item) === "deleted"
                          ? "删除"
                          : "修改"
              }
            >
              {item.ignored
                ? "I"
                : item.index === "?"
                  ? "+"
                  : item.worktree.trim() || item.index.trim()}
            </code>
          )}
        </div>,
      ];
    });
  const file = files.find((f) => f.path === selected?.path);
  const selectedSide = file
    ? selected?.staged
      ? hasStaged(file)
      : !hasUnstaged(file)
    : false;
  const activeFile = file
    ? { path: file.path, staged: selectedSide }
    : undefined;
  const infoPath = previewPath || editing || activeFile?.path || "";
  const fileInfo = useQuery({
    queryKey: ["git", "file-info", c.id, infoPath],
    queryFn: () => api("InspectWorkingFile", c.id, infoPath),
    enabled: tab === "changes" && !!infoPath,
  });
  const infoLanguage =
    languageOverrides[infoPath] || detectLanguage(infoPath);
  const preview = useQuery({
    queryKey: ["git", "file-preview", c.id, previewPath],
    queryFn: () => api("ReadWorkingFilePreview", c.id, previewPath),
    enabled:
      tab === "changes" &&
      !!previewPath &&
      ["image", "audio", "video"].includes(
        fileInfo.data?.previewKind || "",
      ) &&
      !fileInfo.data?.tooLarge,
  });
  const previewText = useQuery({
    queryKey: ["git", "file-text", c.id, previewPath],
    queryFn: () => api("GitFileContent", c.id, previewPath),
    enabled:
      tab === "changes" &&
      !!previewPath &&
      fileInfo.data?.previewKind === "text" &&
      !!fileInfo.data?.editable,
  });
  useEffect(() => {
    const info = fileInfo.data;
    if (!activeFile || editing || !info || info.path !== activeFile.path) return;
    if (info.previewKind !== "text") setPreviewPath(activeFile.path);
  }, [activeFile?.path, editing, fileInfo.data]);
  const diff = useQuery({
    queryKey: ["git", "diff", c.id, activeFile?.path, activeFile?.staged],
    queryFn: () => api("GitDiff", c.id, activeFile!.path, activeFile!.staged),
    enabled: tab === "changes" && !!activeFile,
  });
  const activeRawStats = file
    ? {
        additions:
          (selectedSide ? file.indexAdditions : file.worktreeAdditions) || 0,
        deletions:
          (selectedSide ? file.indexDeletions : file.worktreeDeletions) || 0,
      }
    : { additions: 0, deletions: 0 };
  const activeFilteredStats = diffStats(diff.data || "");
  const activeIgnored = Math.max(
    0,
    activeRawStats.additions +
      activeRawStats.deletions -
      activeFilteredStats.insertions -
      activeFilteredStats.deletions,
  );
  const history = useQuery({
    queryKey: ["git", "history", c.id],
    queryFn: () => api("GitHistory", c.id),
    enabled: tab === "history",
  });
  const commit = history.data?.find((item) => item.hash === commitHash);
  const commitDiff = useQuery({
    queryKey: ["git", "commit-diff", c.id, commit?.hash],
    queryFn: () => api("GitCommitDiff", c.id, commit!.hash),
    enabled: tab === "history" && !!commit,
  });
  const commitDiffFiltered = useQuery({
    queryKey: ["git", "commit-diff-filtered", c.id, commit?.hash],
    queryFn: () => api("GitCommitDiffFiltered", c.id, commit!.hash),
    enabled: tab === "history" && !!commit,
  });
  const historyFiles = useMemo(() => {
    const chunks = (commitDiff.data || "")
      .split(/(?=^diff --git )/m)
      .filter((chunk) => chunk.startsWith("diff --git "));
    return chunks
      .map((diff) => ({
        path: (() => {
          const header =
            /^diff --git (?:"a\/.*" "b\/([^"]+)"|a\/.* b\/(.*))$/m.exec(diff);
          return header?.[1] || header?.[2] || "未知文件";
        })(),
        diff,
        kind: diffChangeKind(diff),
        ...diffStats(diff),
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [commitDiff.data]);
  const historyFilteredFiles = useMemo(() => {
    const chunks = (commitDiffFiltered.data || "")
      .split(/(?=^diff --git )/m)
      .filter((chunk) => chunk.startsWith("diff --git "));
    return chunks
      .map((diff) => ({
        path: (() => {
          const header =
            /^diff --git (?:"a\/.*" "b\/([^"]+)"|a\/.* b\/(.*))$/m.exec(diff);
          return header?.[1] || header?.[2] || "未知文件";
        })(),
        diff,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [commitDiffFiltered.data]);
  const historyRawFile = historyFile
    ? historyFiles.find((item) => item.path === historyFile)
    : undefined;
  const historyDisplayText = historyFile
    ? historyFilteredFiles.find((item) => item.path === historyFile)?.diff ||
      ""
    : commitDiffFiltered.data || "";
  const historyRawStats = historyRawFile
    ? {
        additions: historyRawFile.insertions,
        deletions: historyRawFile.deletions,
      }
    : {
        additions: commit?.insertions || 0,
        deletions: commit?.deletions || 0,
      };
  const historyFilteredStats = diffStats(historyDisplayText);
  const historyIgnored = Math.max(
    0,
    historyRawStats.additions +
      historyRawStats.deletions -
      historyFilteredStats.insertions -
      historyFilteredStats.deletions,
  );
  const historyFileInfo = useQuery({
    queryKey: ["git", "commit-file-info", c.id, commit?.hash, historyFile],
    queryFn: () =>
      api("GitCommitFileInfo", c.id, commit!.hash, historyFile),
    enabled: tab === "history" && !!commit && !!historyFile,
  });
  const historyMedia = useQuery({
    queryKey: ["git", "commit-file-preview", c.id, commit?.hash, historyFile],
    queryFn: () =>
      api("GitCommitFilePreview", c.id, commit!.hash, historyFile),
    enabled:
      tab === "history" &&
      !!commit &&
      !!historyFile &&
      ["image", "audio", "video"].includes(
        historyFileInfo.data?.previewKind || "",
      ) &&
      !historyFileInfo.data?.tooLarge,
  });
  const historyBinary = useQuery({
    queryKey: ["git", "commit-binary-diff", c.id, commit?.hash, historyFile],
    queryFn: () =>
      api("GitCommitBinaryDiff", c.id, commit!.hash, historyFile),
    enabled:
      tab === "history" &&
      !!commit &&
      !!historyFile &&
      historyFileInfo.data?.previewKind === "unsupported",
  });
  const account = st.accounts.find((a) => a.id === accountID),
    profile = effectiveCommitIdentity(
      st,
      c,
      st.profiles.find((p) => p.accountId === accountID),
      !!accountID,
    );
  const authorAccounts = new Set(
    st.profiles
      .filter((p) => p.name === profile?.name && p.email === profile?.email)
      .map((p) => p.accountId),
  );
  const authorAccountID =
    profile && "accountId" in profile
      ? profile.accountId
      : authorAccounts.size === 1
        ? [...authorAccounts][0]
        : "";
  const authorAccount = st.accounts.find((a) => a.id === authorAccountID);
  const stage = (f: FileStatus) => void stageFiles([f], !fullyStaged(f));
  const editingFile = files.find((f) => f.path === editing);
  const editStats = editingFile ? fileStats(editingFile) : { additions: 0, deletions: 0 };
  const editorLineCount = editorText ? editorText.split("\n").length : 1;
  const editorLanguage =
    languageOverrides[editing] || detectLanguage(editing);
  const editable = (f?: FileStatus) =>
    !!f && f.worktree !== "D" && f.index !== "D";
  const commitNow = async () => {
    const taskId = await api("CommitChanges", c.id, remote, draft);
    useUI.getState().submitCommitDraft(c.id, taskId, draft);
  };
  const requestCommit = async () => {
    if (!summary.trim() || !profile) return;
    await execute(async () => {
      setSending(true);
      try {
        const risks = await api(
          "CheckLineEndingRisks",
          c.id,
          staged.map((file) => file.path),
        );
        if (risks.length) {
          setLineEndingError("");
          setLineEndingRisks(risks);
          return;
        }
        await commitNow();
      } finally {
        setSending(false);
      }
    });
  };
  const fixAndCommit = async () => {
    if (!lineEndingRisks) return;
    setLineEndingError("");
    await execute(async () => {
      setLineEndingBusy(true);
      try {
        const paths = lineEndingRisks.map((risk) => risk.path);
        await api("FixLineEndings", c.id, paths);
        await client.invalidateQueries({ queryKey: ["git", "status", c.id] });
        await client.invalidateQueries({ queryKey: ["git", "diff", c.id] });
        const remaining = await api("CheckLineEndingRisks", c.id, paths);
        if (remaining.length) {
          setLineEndingRisks(remaining);
          setLineEndingError(
            "仍有文件存在换行符风险，请检查 .gitattributes 或手动处理后重试",
          );
          return;
        }
        setLineEndingRisks(undefined);
        await commitNow();
      } finally {
        setLineEndingBusy(false);
      }
    });
  };
  const commitAsIs = async () => {
    setLineEndingRisks(undefined);
    await execute(async () => {
      setSending(true);
      try {
        await commitNow();
      } finally {
        setSending(false);
      }
    });
  };
  const openWorking = (path: string, kind: string) => {
    void execute(() =>
      api("OpenWorkingPath", c.id, path, kind),
    );
  };
  const newEntryRaw = newFileName.trim().replace(/^[\\/]+/, "");
  const newEntryIsDirectory =
    newItemKind === "dir" ||
    (/[\\/]$/.test(newEntryRaw) && newEntryRaw !== newFileInitial);
  const changeFormat = (encoding: string, lineEnding: string) => {
    if (!infoPath || formatBusy) return;
    if (editing && editorText !== editorOriginal) {
      window.alert("文件还有未保存的修改，请先保存后再切换编码或换行符。");
      return;
    }
    void execute(async () => {
      setFormatBusy(true);
      try {
        await api("SetWorkingFileFormat", c.id, infoPath, encoding, lineEnding);
        await refreshWorkingTree();
        if (editing) {
          const content = await api("GitFileContent", c.id, editing);
          setEditorText(content);
          setEditorOriginal(content);
        }
      } finally {
        setFormatBusy(false);
      }
    });
  };
  return (
    <div
      className={`desktop-workspace ${activeFile || commit ? "has-file" : ""} ${tab === "changes" && status && files.length === 0 ? "clean-state" : ""}`}
    >
      {tab === "changes" &&
        fileBarSlot &&
        fileInfo.data &&
        createPortal(
          <FileStatusBar
            info={fileInfo.data}
            busy={formatBusy}
            language={infoLanguage}
            wordWrap={wordWrap}
            onChange={changeFormat}
            onLanguage={(language) =>
              setLanguageOverrides((old) => ({ ...old, [infoPath]: language }))
            }
            onToggleWrap={() => setWordWrap((value) => !value)}
            onOpenDefault={() => openWorking(fileInfo.data!.path, "default")}
            onReveal={() => openWorking(fileInfo.data!.path, "reveal")}
          />,
          fileBarSlot,
        )}
      {tab === "history" &&
        fileBarSlot &&
        historyFile &&
        historyFileInfo.data &&
        createPortal(
          <FileStatusBar
            info={historyFileInfo.data}
            busy={false}
            language={detectLanguage(historyFile)}
            wordWrap={wordWrap}
            readOnly
            onToggleWrap={() => setWordWrap((value) => !value)}
            onOpenDefault={() => {}}
            onReveal={() => {}}
          />,
          fileBarSlot,
        )}
      <aside className="desktop-sidebar">
        <div className="desktop-tabs" role="tablist" aria-label="仓库内容">
          <button
            role="tab"
            aria-selected={tab === "changes"}
            className={tab === "changes" ? "active" : ""}
            onClick={() => setTab("changes")}
          >
            <FileText size={14} />
            变更{files.length > 0 && <span>{files.length}</span>}
          </button>
          <button
            role="tab"
            aria-selected={tab === "history"}
            className={tab === "history" ? "active" : ""}
            onClick={() => setTab("history")}
          >
            <Clock3 size={14} />
            历史
          </button>
        </div>
        {tab === "changes" ? (
          <>
            <div className="file-view-toggle" role="tablist" aria-label="文件视图">
              <button
                className={fileView === "changes" ? "active" : ""}
                onClick={() => setFileView("changes")}
              >
                <FileText size={13} />
                变更
              </button>
              <button
                className={fileView === "all" ? "active" : ""}
                onClick={() => setFileView("all")}
              >
                <Files size={13} />
                全部
              </button>
            </div>
            <label className="file-filter">
              <Search size={14} />
              <input
                aria-label="筛选文件"
                placeholder="筛选文件…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </label>
            <div className="file-count">
              {fileView === "changes" && (
                <input
                  type="checkbox"
                  aria-label="将全部变更加入提交"
                  disabled={busy || !!statusError || !status || stagingPaths.size > 0 || !files.length}
                  checked={
                    !!files.length &&
                    files.every(fullyStaged)
                  }
                  onChange={(e) => {
                    void stageFiles(files, e.target.checked);
                  }}
                />
              )}
              <span>
                {fileView === "all"
                  ? allFiles.isPending
                    ? "正在读取文件…"
                    : `${allFiles.data?.length ?? 0} 个文件`
                  : status
                    ? `${files.length} 个变更文件`
                    : "正在读取变更…"}
              </span>
              <button
                type="button"
                className="new-file-button"
                title="新建文件"
                onClick={() => startCreate(createBase, "file")}
              >
                <FilePlus2 size={13} />
                新建
              </button>
              {fileView === "all" && (
                <>
                  <button
                    type="button"
                    className="tree-toggle-button"
                    title="展开全部"
                    aria-label="展开全部"
                    onClick={expandAllTree}
                  >
                    <ChevronsDown size={13} />
                  </button>
                  <button
                    type="button"
                    className="tree-toggle-button"
                    title="折叠全部"
                    aria-label="折叠全部"
                    onClick={collapseAllTree}
                  >
                    <ChevronsUp size={13} />
                  </button>
                </>
              )}
            </div>
            {stageError && <div className="desktop-stage-error" role="alert">{stageError}</div>}
            <div
              className="desktop-file-list"
              onContextMenu={(event) => {
                if (
                  (event.target as Element).closest(
                    ".desktop-file-row, .tree-folder",
                  )
                )
                  return;
                event.preventDefault();
                setTreeSelected("");
                setMenu({
                  x: Math.min(
                    event.clientX,
                    Math.max(8, window.innerWidth - 220),
                  ),
                  y: Math.min(
                    event.clientY,
                    Math.max(8, window.innerHeight - 360),
                  ),
                  node: {
                    name: "",
                    path: "",
                    isDir: true,
                    children: [],
                  },
                });
              }}
            >
              {fileView === "all" && allFiles.isPending ? (
                <Loading />
              ) : fileView === "all" && allFiles.isError ? (
                <ErrorNotice message={errorMessage(allFiles.error)} />
              ) : (
                <>
                  {renderTree(tree, 0)}
                  {!filtered.length && !!sourceFiles.length && (
                    <p className="desktop-list-empty">没有匹配的文件</p>
                  )}
                  {!sourceFiles.length && fileView === "all" && (
                    <p className="desktop-list-empty">仓库中还没有文件</p>
                  )}
                </>
              )}
            </div>
            <form
              className="desktop-commit"
              onSubmit={(e) => {
                e.preventDefault();
                if (!summary.trim() || !profile) return;
                void execute(async () => {
                  setSending(true);
                  try {
                    const taskId = await api(
                      "CommitChanges",
                      c.id,
                      remote,
                      draft,
                    );
                    useUI.getState().submitCommitDraft(c.id, taskId, draft);
                  } finally {
                    setSending(false);
                  }
                });
              }}
            >
              <button
                type="button"
                className="commit-identity"
                onClick={configure}
                title={
                  profile
                    ? `${profile.name} <${profile.email}>`
                    : "配置提交身份"
                }
              >
                {authorAccount ? (
                  <AccountAvatar account={authorAccount} size={26} />
                ) : (
                  <span className="commit-avatar">
                    {profile?.name.slice(0, 2).toUpperCase() || "?"}
                  </span>
                )}
                <span>
                  {profile?.name || "配置提交身份"}
                  <small>{profile?.email || "姓名与邮箱尚未确认"}</small>
                </span>
                <Settings2 size={14} />
              </button>
              <input
                aria-label="提交摘要"
                required
                placeholder="提交摘要（必填）"
                value={summary}
                onChange={(e) => writeDraft(e.target.value, description)}
              />
              <textarea
                aria-label="提交描述"
                placeholder="描述（可选）"
                value={description}
                onChange={(e) => writeDraft(summary, e.target.value)}
                rows={4}
              />
              <div className="commit-caption">
                {!profile
                  ? "请先确认仓库身份"
                  : `${staged.length} 个文件已暂存`}
              </div>
              <button
                className="desktop-primary"
                disabled={
                  busy ||
                  sending ||
                  !!submission ||
                  stagingPaths.size > 0 ||
                  verifying ||
                  !staged.length ||
                  !summary.trim() ||
                  !profile
                }
              >
                提交到 {status?.branch || "当前分支"}
              </button>
            </form>
          </>
        ) : (
          <div className="desktop-history-list">
            {history.isPending ? (
              <Loading />
            ) : history.isError ? (
              <ErrorNotice message={errorMessage(history.error)} />
            ) : history.data?.length ? (
              history.data.map((item) => {
                const labels = commitPills(item);
                return (
                <button
                  className={commit?.hash === item.hash ? "selected" : ""}
                  key={item.hash}
                  onClick={() => { setCommitHash(item.hash); setHistoryFile(""); setCollapsedFolders(new Set()); }}
                >
                  <GitCommitHorizontal size={16} />
                  <span>
                    <strong>{item.subject}</strong>
                    {labels.length > 0 && (
                      <span className="commit-labels">
                        {labels.map((label) => (
                          <span
                            key={label.key}
                            className={label.className}
                            title={label.title}
                          >
                            {label.label}
                          </span>
                        ))}
                      </span>
                    )}
                    <small>
                      {item.author} · <RelativeTime date={item.date} />
                    </small>
                    <small className="history-stats">
                      <span>{item.files} 个文件</span>
                      <span className="stat-add">+{item.insertions}</span>
                      <span className="stat-del">−{item.deletions}</span>
                    </small>
                  </span>
                </button>
                );
              })
            ) : (
              <p className="desktop-list-empty">还没有提交记录</p>
            )}
          </div>
        )}
      </aside>
      <main className="desktop-detail">
        {statusError ? (
          <div className="desktop-block-error">
            <ErrorNotice message={statusError} />
          </div>
        ) : tab === "history" ? (
          commit ? (
            <>
              <div className="desktop-diff-header">
                <GitCommitHorizontal size={16} />
                <strong>{commit.subject}</strong>
                <code>{commit.hash.slice(0, 7)}</code>
                {(!historyFile ||
                  historyFileInfo.data?.previewKind === "text") && (
                  <button
                    className="diff-edit-button"
                    onClick={() =>
                      setDiffMode((mode) =>
                        mode === "split" ? "unified" : "split",
                      )
                    }
                  >
                    <Columns2 size={14} />
                    {diffMode === "split" ? "统一差异" : "并排差异"}
                  </button>
                )}
              </div>
              <div className="desktop-commit-info">
                {commit.author} &lt;{commit.email}&gt; ·{" "}
                {new Date(commit.date).toLocaleString("zh-CN")}
              </div>
              {commitDiff.isPending || commitDiffFiltered.isPending ? (
                <Loading />
              ) : commitDiff.isError ? (
                <ErrorNotice message={errorMessage(commitDiff.error)} />
              ) : commitDiffFiltered.isError ? (
                <ErrorNotice message={errorMessage(commitDiffFiltered.error)} />
              ) : (
                <div className="desktop-history-content">
                  <nav className="desktop-history-tree" aria-label="提交文件树">
                    <div className="history-tree-heading">文件变更 <span>{historyFiles.length}</span></div>
                    <button className={!historyFile ? "selected" : ""} onClick={() => setHistoryFile("")}>
                      <Files size={14} />
                      全部文件
                    </button>
                    {historyFiles.flatMap(({ path, kind }, index) => {
                      const parts = path.split("/");
                      const folders = parts.slice(0, -1);
                      const visible = folders.every((_, level) => !collapsedFolders.has(folders.slice(0, level + 1).join("/")));
                      const previous = historyFiles[index - 1]?.path.split("/") || [];
                      const folderRows = folders.flatMap((name, level) => {
                        const folderPath = folders.slice(0, level + 1).join("/");
                        if (previous.slice(0, level + 1).join("/") === folderPath || folders.slice(0, level).some((_, parent) => collapsedFolders.has(folders.slice(0, parent + 1).join("/")))) return [];
                        return <button key={`folder:${folderPath}`} className="history-folder" style={{ paddingLeft: 10 + level * 13 }} aria-expanded={!collapsedFolders.has(folderPath)} onClick={() => setCollapsedFolders((old) => { const next = new Set(old); if (next.has(folderPath)) next.delete(folderPath); else next.add(folderPath); return next; })}>
                          <ChevronDown size={13} className={collapsedFolders.has(folderPath) ? "collapsed" : ""} /><span>{name}</span>
                        </button>;
                      });
                      return [...folderRows, ...(visible ? [<button key={`file:${path}`} className={`history-file-${kind}${historyFile === path ? " selected" : ""}`} style={{ paddingLeft: 10 + folders.length * 13 }} title={path} onClick={() => setHistoryFile(path)}>
                        <FileText size={14} /><span>{parts.at(-1)}</span>
                      </button>] : [])];
                    })}
                  </nav>
                  {historyFile && historyFileInfo.isPending ? (
                    <Loading />
                  ) : historyFile && historyFileInfo.isError ? (
                    <ErrorNotice message={errorMessage(historyFileInfo.error)} />
                  ) : historyFile &&
                    historyFileInfo.data?.previewKind === "unsupported" ? (
                    <BinaryDiffPane
                      info={historyFileInfo.data}
                      diff={historyBinary.data}
                      loading={historyBinary.isFetching}
                      error={
                        historyBinary.isError
                          ? errorMessage(historyBinary.error)
                          : ""
                      }
                    />
                  ) : historyFile &&
                    ["image", "audio", "video"].includes(
                      historyFileInfo.data?.previewKind || "",
                    ) ? (
                    <CommitMediaPreview
                      info={historyFileInfo.data!}
                      preview={historyMedia.data}
                      loading={historyMedia.isFetching}
                      error={
                        historyMedia.isError
                          ? errorMessage(historyMedia.error)
                          : ""
                      }
                    />
                  ) : diffMode === "split" ? (
                    <SplitDiffView
                      text={historyDisplayText}
                      language={detectLanguage(historyFile)}
                      wordWrap={wordWrap}
                    />
                  ) : (
                    <DiffViewer
                      key={commit.hash + historyFile}
                      text={historyDisplayText}
                      stats={historyRawStats}
                      ignored={historyIgnored}
                      wordWrap={wordWrap}
                    />
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="desktop-empty-detail">
              <Clock3 size={36} strokeWidth={1.3} />
              <h2>提交历史</h2>
              <p>在左侧选择一个提交，查看完整差异。</p>
            </div>
          )
        ) : editing ? (
          <div className="desktop-editor">
            <div className="desktop-diff-header">
              <button
                className="desktop-back"
                aria-label="返回差异"
                onClick={closeEditor}
              >
                <ArrowLeft size={16} />
              </button>
              <FileText size={16} />
              <strong>{editing}</strong>
              <span>
                {editorLineCount} 行 · 第 {cursorLine} 行
              </span>
              <span className="file-line-stats">
                {editStats.additions > 0 && (
                  <span className="stat-add">+{editStats.additions}</span>
                )}
                {editStats.deletions > 0 && (
                  <span className="stat-del">−{editStats.deletions}</span>
                )}
              </span>
              <span className="editor-actions">
                <button
                  onClick={saveEditor}
                  disabled={
                    editorSaving ||
                    editorLoading ||
                    editorText === editorOriginal
                  }
                >
                  <Save size={14} />
                  {editorSaving ? "保存中…" : "保存"}
                </button>
                <button onClick={closeEditor}>关闭</button>
              </span>
            </div>
            {editorError && (
              <div className="desktop-block-error">
                <ErrorNotice message={editorError} />
              </div>
            )}
            {editorLoading ? (
              <Loading />
            ) : (
              <div className="editor-body">
                <div className="editor-code">
                  <pre
                    ref={editorHighlightRef}
                    className={`editor-highlight${wordWrap ? " wrap" : ""}`}
                    aria-hidden="true"
                  >
                    <code>
                      {editorText.split("\n").map((line, index) => (
                        <span className="editor-line" key={index}>
                          <span className="editor-line-number">
                            {index + 1}
                          </span>
                          <span
                            className="editor-line-text"
                            dangerouslySetInnerHTML={{
                              __html: highlightCode(line, editorLanguage),
                            }}
                          />
                        </span>
                      ))}
                    </code>
                  </pre>
                  <textarea
                    ref={editorRef}
                    aria-label={`编辑 ${editing}`}
                    value={editorText}
                    spellCheck={false}
                    wrap={wordWrap ? "soft" : "off"}
                    className={wordWrap ? "wrap" : ""}
                    onChange={(e) => {
                      setEditorText(e.target.value);
                      updateCursorLine();
                    }}
                    onScroll={(e) => {
                      if (editorHighlightRef.current) {
                        editorHighlightRef.current.scrollTop =
                          e.currentTarget.scrollTop;
                        editorHighlightRef.current.scrollLeft =
                          e.currentTarget.scrollLeft;
                      }
                    }}
                    onClick={updateCursorLine}
                    onKeyUp={updateCursorLine}
                    onSelect={updateCursorLine}
                    onKeyDown={(e) => {
                      if (
                        (e.ctrlKey || e.metaKey) &&
                        e.key.toLowerCase() === "s"
                      ) {
                        e.preventDefault();
                        void saveEditor();
                      }
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        ) : previewPath ? (
          <FilePreviewPane
            path={previewPath}
            info={fileInfo.data}
            preview={preview.data}
            text={previewText.data}
            language={infoLanguage}
            wordWrap={wordWrap}
            loading={
              fileInfo.isPending ||
              preview.isFetching ||
              previewText.isFetching
            }
            error={
              fileInfo.isError
                ? errorMessage(fileInfo.error)
                : preview.isError
                  ? errorMessage(preview.error)
                  : previewText.isError
                    ? errorMessage(previewText.error)
                    : ""
            }
            onClose={() => {
              setPreviewPath("");
              setSelected(undefined);
            }}
            onEdit={() => void openEditor(previewPath)}
            onOpenDefault={() => openWorking(previewPath, "default")}
            onReveal={() => openWorking(previewPath, "reveal")}
          />
        ) : activeFile ? (
          <>
            <div className="desktop-diff-header">
              <button
                className="desktop-back"
                aria-label="返回变更列表"
                onClick={() => setSelected(undefined)}
              >
                <ArrowLeft size={16} />
              </button>
              <FileText size={16} />
              <strong>
                {file?.originalPath
                  ? `${file.originalPath} → ${activeFile.path}`
                  : activeFile.path}
              </strong>
              <span>{activeFile.staged ? "已暂存" : "工作区"}</span>
              {file && (
                <span className="file-line-stats">
                  {fileStats(file).additions > 0 && (
                    <span className="stat-add">
                      +{fileStats(file).additions}
                    </span>
                  )}
                  {fileStats(file).deletions > 0 && (
                    <span className="stat-del">
                      −{fileStats(file).deletions}
                    </span>
                  )}
                </span>
              )}
              <button
                className="diff-edit-button"
                onClick={() =>
                  setDiffMode((mode) =>
                    mode === "split" ? "unified" : "split",
                  )
                }
              >
                <Columns2 size={14} />
                {diffMode === "split" ? "统一差异" : "并排差异"}
              </button>
              <button
                className="diff-edit-button"
                title="显示完整文件内容"
                onClick={() => openPreview(activeFile.path)}
              >
                <Eye size={14} />
                完整文件
              </button>
              <button
                className="diff-edit-button"
                disabled={!editable(file)}
                title={editable(file) ? "在应用中编辑文件" : "该文件不可编辑"}
                onClick={() => void openEditor(activeFile.path)}
              >
                <Pencil size={14} />
                编辑
              </button>
            </div>
            {diff.isPending ? (
              <Loading />
            ) : diff.isError ? (
              <ErrorNotice message={errorMessage(diff.error)} />
            ) : diff.data || activeIgnored > 0 ? (
              diffMode === "split" && diff.data ? (
                <SplitDiffView
                  text={diff.data}
                  language={infoLanguage}
                  wordWrap={wordWrap}
                />
              ) : (
                <DiffViewer
                  key={activeFile.path + activeFile.staged}
                  text={diff.data || ""}
                  stats={activeRawStats}
                  ignored={activeIgnored}
                  showFileHeaders={false}
                  wordWrap={wordWrap}
                />
              )
            ) : (
              <div className="desktop-empty-detail">
                <FileText size={32} />
                <h2>暂无文本差异</h2>
                <p>
                  {file?.index === "?"
                    ? "新文件尚未跟踪。勾选文件加入暂存后可查看差异。"
                    : "差异为空：可能仅包含换行符变化（已忽略），或为二进制、重命名、文件属性变化。"}
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="desktop-start">
            <h2>
              {!status
                ? "正在读取仓库…"
                : files.length
                  ? "查看你的修改"
                  : "没有本地变更"}
            </h2>
            <p className="desktop-checkout-path">{c.path}</p>
            {files.length > 0 && <p>选择左侧文件查看差异。</p>}
            <div className="desktop-next-actions">
              <ActionRow
                title="在外部编辑器中打开仓库"
                action="打开编辑器"
                onClick={() =>
                  void execute(() => api("OpenCheckout", c.id, "editor"))
                }
              />
              <ActionRow
                title="在文件夹中查看仓库"
                action="打开文件夹"
                onClick={() =>
                  void execute(() => api("OpenCheckout", c.id, "folder"))
                }
              />
              {row.repository && (
                <ActionRow
                  title="在 GitHub 中查看仓库"
                  action="查看 GitHub"
                  onClick={openRepository}
                />
              )}
            </div>
            {!remote ? (
              <p className="desktop-context-note">
                请选择有效的 remote 并确认身份。
                <button onClick={configure}>仓库设置</button>
              </p>
            ) : !profile ? (
              <p className="desktop-context-note">
                此本地副本尚未绑定提交身份。
                <button onClick={configure}>配置身份</button>
              </p>
            ) : account?.status === "auth_required" ? (
              <p className="desktop-context-note">
                {account.login} 需要重新授权；本地提交仍可使用。
                <button onClick={accountSettings}>管理账号</button>
              </p>
            ) : null}
          </div>
        )}
      </main>
      {lineEndingRisks && (
        <Modal
          title="检测到换行符风险"
          onClose={() => {
            if (!lineEndingBusy) setLineEndingRisks(undefined);
          }}
        >
          <p>以下文件包含混合换行符，或与仓库的 eol 规则不一致：</p>
          <div className="line-ending-list">
            {lineEndingRisks.map((risk) => (
              <div className="line-ending-row" key={risk.path}>
                <code>{risk.path}</code>
                <span>
                  {risk.mixed ? "混合" : risk.policy ? `规则 ${risk.policy}` : "风险"}
                </span>
                <small>
                  CRLF {risk.crlf} · LF {risk.lf}
                </small>
              </div>
            ))}
          </div>
          <p className="subtle-note">
            存在 .gitattributes 时将优先按其 eol 规则修复；没有显式规则时按 Git 文本规则规范化为 LF。
          </p>
          {lineEndingError && (
            <div className="desktop-stage-error" role="alert">
              {lineEndingError}
            </div>
          )}
          <div className="form-actions">
            <button
              type="button"
              disabled={lineEndingBusy}
              onClick={() => setLineEndingRisks(undefined)}
            >
              取消
            </button>
            <button
              type="button"
              disabled={lineEndingBusy}
              onClick={() => void commitAsIs()}
            >
              原样提交
            </button>
            <button
              type="button"
              className="primary"
              disabled={lineEndingBusy}
              onClick={() => void fixAndCommit()}
            >
              {lineEndingBusy ? "正在修复…" : "按 Git 规则修复并提交"}
            </button>
          </div>
        </Modal>
      )}
      <FileContextMenu
        menu={menu}
        setMenu={setMenu}
        rootPath={c.path}
        clipboard={clipboard}
        stageNode={stageNode}
        nodeStaged={nodeStaged}
        ignoreNode={ignoreNode}
        forceTrackNode={forceTrackNode}
        untrackNode={untrackNode}
        openWorking={openWorking}
        startCreate={startCreate}
        pasteInto={pasteInto}
        copyEntry={copyEntry}
        setRenameTarget={setRenameTarget}
        setRenameName={setRenameName}
        setRenameError={setRenameError}
        removeEntry={removeEntry}
        openPreview={openPreview}
        openEditor={openEditor}
        editable={editable}
        isChanged={isChanged}
      />
      {newFileOpen && (
        <Modal
          title="新建文件或目录"
          onClose={() => setNewFileOpen(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void createFile();
            }}
          >
            <Field
              label={newEntryIsDirectory ? "目录路径" : "文件路径"}
              hint="相对仓库根目录；路径以 / 或 \\ 结尾时创建目录。"
            >
              <input
                autoFocus
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                placeholder={
                  newEntryIsDirectory ? "src/new-folder/" : "src/new.ts"
                }
              />
            </Field>
            {newFileError && (
              <div className="desktop-stage-error" role="alert">
                {newFileError}
              </div>
            )}
            <div className="form-actions">
              <button type="button" onClick={() => setNewFileOpen(false)}>
                <X size={14} />
                取消
              </button>
              <button className="primary" disabled={!newFileName.trim()}>
                {newEntryIsDirectory ? (
                  <FolderPlus size={14} />
                ) : (
                  <FilePlus2 size={14} />
                )}
                {newEntryIsDirectory ? "创建目录" : "创建文件"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {renameTarget && (
        <Modal
          title="重命名"
          onClose={() => setRenameTarget(undefined)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void renameEntry();
            }}
          >
            <Field label="新名称" hint={renameTarget.path}>
              <input
                autoFocus
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
              />
            </Field>
            {renameError && (
              <div className="desktop-stage-error" role="alert">
                {renameError}
              </div>
            )}
            <div className="form-actions">
              <button
                type="button"
                onClick={() => setRenameTarget(undefined)}
              >
                <X size={14} />
                取消
              </button>
              <button
                className="primary"
                disabled={!renameName.trim() || renameName === renameTarget.name}
              >
                <Pencil size={14} />
                重命名
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
function RelativeTime({ date }: { date: string }) {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return <>{date}</>;
  const seconds = Math.max(0, Math.floor((Date.now() - value.getTime()) / 1000));
  if (seconds < 60) return <>刚刚</>;
  if (seconds < 3600) return <>{Math.floor(seconds / 60)} 分钟前</>;
  if (seconds < 86400) return <>{Math.floor(seconds / 3600)} 小时前</>;
  if (seconds < 7 * 86400) return <>{Math.floor(seconds / 86400)} 天前</>;
  return <>{value.toLocaleDateString("zh-CN")}</>;
}



