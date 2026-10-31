import { useMemo, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Folder, FolderOpen, GitBranch } from "lucide-react";
import type { Branch } from "./types";

type BranchTreeNode = {
  name: string;
  path: string;
  branch?: Branch;
  children: BranchTreeNode[];
};

function buildBranchTree(branches: Branch[]): BranchTreeNode[] {
  type MutableNode = {
    name: string;
    path: string;
    branch?: Branch;
    children: Map<string, MutableNode>;
  };
  const root = new Map<string, MutableNode>();
  for (const branch of branches) {
    const parts = branch.name.split("/");
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
          branch: leaf ? branch : undefined,
          children: new Map(),
        };
        children.set(part, node);
      }
      if (leaf) node.branch = branch;
      else children = node.children;
    });
  }
  const finish = (children: Map<string, MutableNode>): BranchTreeNode[] =>
    [...children.values()]
      .sort((a, b) =>
        !a.branch && b.branch
          ? -1
          : a.branch && !b.branch
            ? 1
            : a.name.localeCompare(b.name),
      )
      .map((node) => ({
        name: node.name,
        path: node.path,
        branch: node.branch,
        children: finish(node.children),
      }));
  return finish(root);
}

export function BranchTreeView({
  branches,
  prefix,
  search,
  collapsed,
  setCollapsed,
  onSwitch,
  busy,
}: {
  branches: Branch[];
  prefix: string;
  search: string;
  collapsed: Set<string>;
  setCollapsed: (value: (old: Set<string>) => Set<string>) => void;
  onSwitch: (name: string) => void;
  busy: boolean;
}) {
  const filtered = useMemo(
    () =>
      branches.filter((branch) =>
        branch.name.toLowerCase().includes(search.toLowerCase()),
      ),
    [branches, search],
  );
  const tree = useMemo(() => buildBranchTree(filtered), [filtered]);
  const render = (nodes: BranchTreeNode[], depth: number): ReactNode[] =>
    nodes.flatMap((node) => {
      const key = `${prefix}:${node.path}`;
      if (node.branch) {
        const branch = node.branch;
        return [
          <button
            type="button"
            key={`leaf:${key}`}
            className={`branch-leaf${branch.current ? " current" : ""}`}
            style={{ paddingLeft: 12 + depth * 15 }}
            title={branch.name}
            disabled={busy || branch.current}
            onClick={() => onSwitch(branch.name)}
          >
            <GitBranch size={13} />
            <span>{node.name}</span>
            {branch.current && <Check size={13} />}
          </button>,
        ];
      }
      const expanded = !!search || !collapsed.has(key);
      return [
        <button
          type="button"
          key={`folder:${key}`}
          className="branch-folder"
          style={{ paddingLeft: 10 + depth * 15 }}
          aria-expanded={expanded}
          onClick={() =>
            setCollapsed((old) => {
              const next = new Set(old);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            })
          }
        >
          {expanded ? (
            <ChevronDown size={13} />
          ) : (
            <ChevronRight size={13} />
          )}
          {expanded ? <FolderOpen size={13} /> : <Folder size={13} />}
          <span>{node.name}</span>
        </button>,
        ...(expanded ? render(node.children, depth + 1) : []),
      ];
    });
  return <div className="branch-tree">{render(tree, 0)}</div>;
}

