import type { QueryClient } from "@tanstack/react-query";
import type { Task } from "./types";

const workingQueries = ["status", "health", "files", "diff", "file-info", "file-text", "file-preview"];
const branchQueries = ["status", "branches", "history"];

export function refreshCheckoutQueries(client: QueryClient, checkoutId: string, groups: string[]) {
  return client.invalidateQueries({
    predicate: ({ queryKey: [namespace, group, id] }) =>
      namespace === "git" && id === checkoutId && typeof group === "string" && groups.includes(group),
  });
}

export function refreshWorkingQueries(client: QueryClient, checkoutId: string, history = false) {
  return refreshCheckoutQueries(client, checkoutId, history ? [...workingQueries, ...branchQueries] : workingQueries);
}

export function refreshGitTask(client: QueryClient, task: Task) {
  switch (task.kind) {
    case "fetch":
    case "push":
    case "share":
      return refreshCheckoutQueries(client, task.target, branchQueries);
    case "branch":
    case "pull":
    case "commit":
      return refreshWorkingQueries(client, task.target, true);
  }
}
