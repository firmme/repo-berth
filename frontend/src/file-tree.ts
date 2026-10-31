import type { FileStatus } from "./types";

export type FileTreeNode = {
  name: string;
  path: string;
  isDir: boolean;
  file?: FileStatus;
  children: FileTreeNode[];
};

export function parentPath(path: string) {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

export function absoluteWorkingPath(root: string, path: string) {
  if (!path) return root;
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}${path.replace(/\//g, separator)}`;
}

export function findTreeNode(
  nodes: FileTreeNode[],
  path: string,
): FileTreeNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node;
    const found = findTreeNode(node.children, path);
    if (found) return found;
  }
  return undefined;
}

export function buildFileTree(
  files: FileStatus[],
  rootNode?: { name: string; path: string },
): FileTreeNode[] {
  type MutableNode = {
    name: string;
    path: string;
    isDir: boolean;
    file?: FileStatus;
    children: Map<string, MutableNode>;
  };
  const root = new Map<string, MutableNode>();
  for (const file of files) {
    const parts = file.path.split("/");
    let children = root;
    let prefix = "";
    parts.forEach((part, index) => {
      prefix = prefix ? `${prefix}/${part}` : part;
      const leaf = index === parts.length - 1;
      let node = children.get(part);
      if (!node) {
        node = {
          name: part,
          path: prefix,
          isDir: !leaf,
          file: leaf ? file : undefined,
          children: new Map(),
        };
        children.set(part, node);
      }
      if (leaf) {
        node.isDir = false;
        node.file = file;
      } else {
        node.isDir = true;
        children = node.children;
      }
    });
  }
  const finish = (children: Map<string, MutableNode>): FileTreeNode[] =>
    [...children.values()]
      .sort((a, b) =>
        a.isDir === b.isDir
          ? a.name.localeCompare(b.name)
          : a.isDir
            ? -1
            : 1,
      )
      .map((node) => ({
        name: node.name,
        path: node.path,
        isDir: node.isDir,
        file: node.file,
        children: finish(node.children),
      }));
  const children = finish(root);
  if (rootNode) {
    return [
      {
        name: rootNode.name,
        path: rootNode.path,
        isDir: true,
        children,
      },
    ];
  }
  return children;
}

export function fileStats(file: FileStatus) {
  return {
    additions:
      (file.indexAdditions || 0) + (file.worktreeAdditions || 0),
    deletions:
      (file.indexDeletions || 0) + (file.worktreeDeletions || 0),
  };
}

export function flattenTree(node: FileTreeNode): FileStatus[] {
  if (node.file) return [node.file];
  return node.children.flatMap(flattenTree);
}

export function treeStats(node: FileTreeNode) {
  return flattenTree(node).reduce(
    (total, file) => {
      const stats = fileStats(file);
      return {
        additions: total.additions + stats.additions,
        deletions: total.deletions + stats.deletions,
      };
    },
    { additions: 0, deletions: 0 },
  );
}

export function hasStaged(f: FileStatus) {
  return f.index !== " " && f.index !== "?";
}
export function hasUnstaged(f: FileStatus) {
  return f.worktree !== " " || f.index === "?";
}

