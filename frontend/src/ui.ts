import { create } from "zustand";
import type { Task } from "./types";
type View = "repositories" | "accounts" | "settings";
interface UI {
  view: View;
  scope: string;
  selected: string;
  query: string;
  tasksOpen: boolean;
  menuOpen: boolean;
  commitDrafts: Record<string, string>;
  commitSubmissions: Record<string, { taskId: string; message: string }>;
  setCommitDraft: (checkout: string, message: string) => void;
  submitCommitDraft: (
    checkout: string,
    taskId: string,
    message: string,
  ) => void;
  settleCommitDrafts: (tasks: Task[]) => void;
  set: (patch: Partial<UI>) => void;
}
export const useUI = create<UI>((set) => ({
  view: "repositories",
  scope: "all",
  selected: "",
  query: "",
  tasksOpen: false,
  menuOpen: false,
  commitDrafts: {},
  commitSubmissions: {},
  setCommitDraft: (checkout, message) =>
    set((s) => ({ commitDrafts: { ...s.commitDrafts, [checkout]: message } })),
  submitCommitDraft: (checkout, taskId, message) =>
    set((s) => ({
      commitSubmissions: {
        ...s.commitSubmissions,
        [checkout]: { taskId, message },
      },
    })),
  settleCommitDrafts: (tasks) =>
    set((s) => {
      const finished = Object.entries(s.commitSubmissions).filter(
        ([, submission]) =>
          tasks.some(
            (t) =>
              t.id === submission.taskId &&
              !["queued", "running"].includes(t.state),
          ),
      );
      if (!finished.length) return s;
      const drafts = { ...s.commitDrafts };
      const submissions = { ...s.commitSubmissions };
      for (const [checkout, submission] of finished) {
        const task = tasks.find((t) => t.id === submission.taskId)!;
        if (
          task.state === "succeeded" &&
          drafts[checkout] === submission.message
        )
          delete drafts[checkout];
        delete submissions[checkout];
      }
      return { commitDrafts: drafts, commitSubmissions: submissions };
    }),
  set: (patch) => set(patch),
}));
