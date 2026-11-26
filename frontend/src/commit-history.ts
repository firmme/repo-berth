import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { diffChangeKind, diffStats } from "./diff-view";

function splitCommitDiff(patch = "") {
  return patch
    .split(/(?=^diff --git )/m)
    .filter((diff) => diff.startsWith("diff --git "))
    .map((diff) => {
      const header = /^diff --git (?:"a\/.*" "b\/([^"]+)"|a\/.* b\/(.*))$/m.exec(diff);
      return { path: header?.[1] || header?.[2] || "未知文件", diff };
    });
}

export function useCommitHistory(checkoutId: string, enabled: boolean, commitHash: string, historyFile: string) {
  const history = useQuery({
    queryKey: ["git", "history", checkoutId],
    queryFn: () => api("GitHistory", checkoutId),
    enabled: enabled,
  });
  const commit = history.data?.find((item) => item.hash === commitHash);
  const commitDiff = useQuery({
    queryKey: ["git", "commit-diff", checkoutId, commit?.hash],
    queryFn: () => api("GitCommitDiff", checkoutId, commit!.hash),
    enabled: enabled && !!commit,
  });
  const commitDiffFiltered = useQuery({
    queryKey: ["git", "commit-diff-filtered", checkoutId, commit?.hash],
    queryFn: () => api("GitCommitDiffFiltered", checkoutId, commit!.hash),
    enabled: enabled && !!commit,
  });
  const historyFiles = useMemo(
    () => splitCommitDiff(commitDiff.data).map((file) => ({
      ...file,
      kind: diffChangeKind(file.diff),
      ...diffStats(file.diff),
    })).sort((a, b) => a.path.localeCompare(b.path)),
    [commitDiff.data],
  );
  const historyFilteredFiles = useMemo(
    () => new Map(splitCommitDiff(commitDiffFiltered.data).map((file) => [file.path, file.diff])),
    [commitDiffFiltered.data],
  );
  const historyRawFile = historyFile
    ? historyFiles.find((item) => item.path === historyFile)
    : undefined;
  const historyDisplayText = historyFile
    ? historyFilteredFiles.get(historyFile) ||
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
    queryKey: ["git", "commit-file-info", checkoutId, commit?.hash, historyFile],
    queryFn: () =>
      api("GitCommitFileInfo", checkoutId, commit!.hash, historyFile),
    enabled: enabled && !!commit && !!historyFile,
  });
  const historyMedia = useQuery({
    queryKey: ["git", "commit-file-preview", checkoutId, commit?.hash, historyFile],
    queryFn: () =>
      api("GitCommitFilePreview", checkoutId, commit!.hash, historyFile),
    enabled:
      enabled &&
      !!commit &&
      !!historyFile &&
      ["image", "audio", "video"].includes(
        historyFileInfo.data?.previewKind || "",
      ) &&
      !historyFileInfo.data?.tooLarge,
  });
  const historyBinary = useQuery({
    queryKey: ["git", "commit-binary-diff", checkoutId, commit?.hash, historyFile],
    queryFn: () =>
      api("GitCommitBinaryDiff", checkoutId, commit!.hash, historyFile),
    enabled:
      enabled &&
      !!commit &&
      !!historyFile &&
      historyFileInfo.data?.previewKind === "unsupported",
  });
  return {
    history, commit, commitDiff, commitDiffFiltered, historyFiles, historyRawFile,
    historyDisplayText, historyRawStats, historyIgnored, historyFileInfo, historyMedia, historyBinary,
  };
}
