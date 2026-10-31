import type { Commit } from "./types";

const commitTypeLabels: Record<string, string> = {
  feat: "功能",
  fix: "修复",
  hotfix: "修复",
  docs: "文档",
  style: "样式",
  refactor: "重构",
  perf: "性能",
  test: "测试",
  build: "构建",
  ci: "CI",
  chore: "杂项",
  revert: "回滚",
  release: "发布",
};

export type CommitPill = { key: string; label: string; className: string; title: string };

export function commitPills(commit: Commit): CommitPill[] {
  const pills: CommitPill[] = [];
  const typeMatch = /^([a-zA-Z]+)(?:\([^)]*\))?!?:/.exec(commit.subject);
  const type = typeMatch?.[1]?.toLowerCase() || "";
  if (commitTypeLabels[type]) {
    pills.push({
      key: `type:${type}`,
      label: commitTypeLabels[type],
      className: `commit-pill type-${type}`,
      title: `提交类型：${type}`,
    });
  }
  if (commit.parents > 1) {
    pills.push({
      key: "merge",
      label: "合并",
      className: "commit-pill merge",
      title: "合并提交",
    });
  }
  const tags = commit.tags || [];
  const release =
    type !== "release" &&
    (/^(?:chore\()?release(?:\)[^:]*)?!?:/i.test(commit.subject) ||
      tags.some(
        (tag) =>
          /release/i.test(tag) ||
          /^v?\d+(?:\.\d+){1,2}(?:[-+].*)?$/i.test(tag),
      ));
  if (release) {
    pills.push({
      key: "release",
      label: "发布",
      className: "commit-pill release",
      title: "发布版本",
    });
  }
  tags.slice(0, 2).forEach((tag) =>
    pills.push({
      key: `tag:${tag}`,
      label: tag,
      className: "commit-pill tag",
      title: `标签：${tag}`,
    }),
  );
  if (tags.length > 2) {
    pills.push({
      key: "tag-more",
      label: `+${tags.length - 2}`,
      className: "commit-pill tag",
      title: tags.slice(2).join(", "),
    });
  }
  return pills;
}

