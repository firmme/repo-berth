import type { ReactNode } from "react";
import {
  Check,
  ChevronRight,
  ClipboardPaste,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FilePlus2,
  FolderOpen,
  FolderPlus,
  Pencil,
  Scissors,
  Terminal,
  Trash2,
} from "lucide-react";
import type { FileStatus } from "./types";
import {
  absoluteWorkingPath,
  flattenTree,
  parentPath,
  type FileTreeNode,
} from "./file-tree";

export type FileContextMenuState = {
  x: number;
  y: number;
  node: FileTreeNode;
};

type Props = {
  menu?: FileContextMenuState;
  setMenu: (value: undefined) => void;
  rootPath: string;
  clipboard?: { path: string; cut: boolean };
  stageNode: (node: FileTreeNode, next: boolean) => void;
  nodeStaged: (node: FileTreeNode) => boolean;
  ignoreNode: (node: FileTreeNode) => void;
  untrackNode: (node: FileTreeNode) => void;
  openWorking: (path: string, kind: string) => void;
  startCreate: (base: string, kind: "file" | "dir") => void;
  pasteInto: (node: FileTreeNode) => void;
  copyEntry: (node: FileTreeNode, cut: boolean) => void;
  setRenameTarget: (node: FileTreeNode) => void;
  setRenameName: (name: string) => void;
  setRenameError: (error: string) => void;
  removeEntry: (node: FileTreeNode) => void;
  openPreview: (path: string) => void;
  openEditor: (path: string) => void;
  editable: (file?: FileStatus) => boolean;
  isChanged: (file: FileStatus) => boolean;
};

export function FileContextMenu({
  menu,
  setMenu,
  rootPath,
  clipboard,
  stageNode,
  nodeStaged,
  ignoreNode,
  untrackNode,
  openWorking,
  startCreate,
  pasteInto,
  copyEntry,
  setRenameTarget,
  setRenameName,
  setRenameError,
  removeEntry,
  openPreview,
  openEditor,
  editable,
  isChanged,
}: Props) {
  return (
    <>
      {menu && (
        <div
          className={`desktop-context-menu${menu.x > window.innerWidth - 460 ? " submenu-left" : ""}`}
          role="menu"
          style={{ left: menu.x, top: menu.y }}
        >
          {menu.node.isDir ? (
            <>
              <ContextSubmenu label="新建">
                <button onClick={() => startCreate(menu.node.path, "file")}>
                  <FilePlus2 size={14} />
                  {menu.node.path ? "新建子文件…" : "新建文件…"}
                </button>
                <button onClick={() => startCreate(menu.node.path, "dir")}>
                  <FolderPlus size={14} />
                  {menu.node.path ? "新建子目录…" : "新建目录…"}
                </button>
              </ContextSubmenu>
              <button onClick={() => openWorking(menu.node.path, "folder")}>
                <FolderOpen size={14} />
                打开文件夹
              </button>
              <button onClick={() => openWorking(menu.node.path, "terminal")}>
                <Terminal size={14} />
                在终端中打开
              </button>
              {clipboard && (
                <button onClick={() => pasteInto(menu.node)}>
                  <ClipboardPaste size={14} />
                  粘贴{clipboard.cut ? "（移动）" : ""}
                </button>
              )}
              {menu.node.path && <div className="context-separator" />}
              {menu.node.path &&
                flattenTree(menu.node).some(isChanged) && (
                  <button
                    onClick={() =>
                      stageNode(menu.node, !nodeStaged(menu.node))
                    }
                  >
                    {nodeStaged(menu.node) ? "取消暂存目录" : "暂存目录"}
                  </button>
                )}
              {menu.node.path && (
                <button onClick={() => ignoreNode(menu.node)}>
                  <EyeOff size={14} />
                  添加到 .gitignore
                </button>
              )}
              {menu.node.path &&
                flattenTree(menu.node).some(
                  (file) => file.tracked ?? file.index !== "?",
                ) && (
                  <button onClick={() => untrackNode(menu.node)}>
                    <Trash2 size={14} />
                    移除 Git 跟踪
                  </button>
                )}
              {menu.node.path && <div className="context-separator" />}
              {menu.node.path && (
                <>
                  <ContextSubmenu label="复制">
                    <button
                      onClick={() => {
                        void navigator.clipboard.writeText(menu.node.path);
                        setMenu(undefined);
                      }}
                    >
                      <Copy size={14} />
                      复制相对路径
                    </button>
                    <button
                      onClick={() => {
                        void navigator.clipboard.writeText(
                          absoluteWorkingPath(rootPath, menu.node.path),
                        );
                        setMenu(undefined);
                      }}
                    >
                      <Copy size={14} />
                      复制绝对路径
                    </button>
                    <button
                      onClick={() => {
                        void navigator.clipboard.writeText(menu.node.name);
                        setMenu(undefined);
                      }}
                    >
                      <Copy size={14} />
                      复制名称
                    </button>
                    <button onClick={() => copyEntry(menu.node, false)}>
                      <Copy size={14} />
                      复制到剪贴板
                    </button>
                    <button onClick={() => copyEntry(menu.node, true)}>
                      <Scissors size={14} />
                      剪切
                    </button>
                  </ContextSubmenu>
                  <button
                    onClick={() => {
                      setRenameTarget(menu.node);
                      setRenameName(menu.node.name);
                      setRenameError("");
                      setMenu(undefined);
                    }}
                  >
                    <Pencil size={14} />
                    重命名…
                  </button>
                  <button onClick={() => removeEntry(menu.node)}>
                    <Trash2 size={14} />
                    删除…
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <button onClick={() => openPreview(menu.node.path)}>
                <Eye size={14} />
                预览
              </button>
              <button
                disabled={!editable(menu.node.file)}
                onClick={() => void openEditor(menu.node.path)}
              >
                <Pencil size={14} />
                编辑文件
              </button>
              <button onClick={() => openWorking(menu.node.path, "default")}>
                <ExternalLink size={14} />
                用默认应用打开
              </button>
              <button onClick={() => openWorking(menu.node.path, "reveal")}>
                <FolderOpen size={14} />
                打开文件所在位置
              </button>
              <div className="context-separator" />
              <ContextSubmenu label="新建">
                <button
                  onClick={() =>
                    startCreate(parentPath(menu.node.path), "file")
                  }
                >
                  <FilePlus2 size={14} />
                  新建同级文件…
                </button>
                <button
                  onClick={() =>
                    startCreate(parentPath(menu.node.path), "dir")
                  }
                >
                  <FolderPlus size={14} />
                  新建同级目录…
                </button>
              </ContextSubmenu>
              <button
                onClick={() => pasteInto(menu.node)}
                disabled={!clipboard}
              >
                <ClipboardPaste size={14} />
                粘贴{clipboard?.cut ? "（移动）" : ""}
              </button>
              <div className="context-separator" />
              {isChanged(menu.node.file!) && (
                <button
                  onClick={() =>
                    stageNode(menu.node, !nodeStaged(menu.node))
                  }
                >
                  {nodeStaged(menu.node) ? "取消暂存" : "暂存"}
                </button>
              )}
              <button onClick={() => ignoreNode(menu.node)}>
                <EyeOff size={14} />
                添加到 .gitignore
              </button>
              {(menu.node.file!.tracked ??
                menu.node.file!.index !== "?") && (
                <button onClick={() => untrackNode(menu.node)}>
                  <Trash2 size={14} />
                  移除 Git 跟踪
                </button>
              )}
              <div className="context-separator" />
              <ContextSubmenu label="复制">
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(menu.node.path);
                    setMenu(undefined);
                  }}
                >
                  <Copy size={14} />
                  复制相对路径
                </button>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(
                      absoluteWorkingPath(rootPath, menu.node.path),
                    );
                    setMenu(undefined);
                  }}
                >
                  <Copy size={14} />
                  复制绝对路径
                </button>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(menu.node.name);
                    setMenu(undefined);
                  }}
                >
                  <Copy size={14} />
                  复制文件名
                </button>
                <button onClick={() => copyEntry(menu.node, false)}>
                  <Copy size={14} />
                  复制到剪贴板
                </button>
                <button onClick={() => copyEntry(menu.node, true)}>
                  <Scissors size={14} />
                  剪切
                </button>
              </ContextSubmenu>
              <button
                onClick={() => {
                  setRenameTarget(menu.node);
                  setRenameName(menu.node.name);
                  setRenameError("");
                  setMenu(undefined);
                }}
              >
                <Pencil size={14} />
                重命名…
              </button>
              <button onClick={() => removeEntry(menu.node)}>
                <Trash2 size={14} />
                删除…
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}

function ContextSubmenu({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="context-submenu">
      <button type="button" className="context-submenu-trigger">
        {label}
        <ChevronRight size={13} />
      </button>
      <div className="context-submenu-panel">{children}</div>
    </div>
  );
}
