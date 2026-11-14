import { beforeEach, expect, it } from "vitest";
import { useUI } from "./ui";
import type { Task } from "./types";

beforeEach(() =>
  useUI.setState({
    commitDrafts: {},
    commitSubmissions: {},
    unreadTaskIds: [],
    localTasks: [],
    tasksOpen: false,
    toastTaskId: "",
    toastRevision: 0,
  }),
);
const outcome = (state: string): Task => ({
  id: "commit-task",
  kind: "commit",
  target: "work",
  state,
  progress: "",
  error: "",
  errorCode: "",
  startedAt: "",
  finishedAt: "",
});

it("keeps a submitted commit draft through queuing and failure", () => {
  const ui = useUI.getState();
  ui.setCommitDraft("work", "work changes");
  ui.submitCommitDraft("work", "commit-task", "work changes");
  ui.settleCommitDrafts([outcome("queued")]);
  expect(useUI.getState().commitDrafts.work).toBe("work changes");
  expect(useUI.getState().commitSubmissions.work).toBeTruthy();
  ui.settleCommitDrafts([outcome("failed")]);
  expect(useUI.getState().commitDrafts.work).toBe("work changes");
  expect(useUI.getState().commitSubmissions.work).toBeUndefined();
});
it("clears only the successfully committed text from the matching local copy", () => {
  const ui = useUI.getState();
  ui.setCommitDraft("personal", "personal changes");
  ui.setCommitDraft("work", "work changes");
  ui.submitCommitDraft("work", "commit-task", "work changes");
  ui.settleCommitDrafts([outcome("succeeded")]);
  expect(useUI.getState().commitDrafts.work).toBeUndefined();
  expect(useUI.getState().commitDrafts.personal).toBe("personal changes");
});
it("preserves edits written while a commit is running and releases interrupted attempts", () => {
  const ui = useUI.getState();
  ui.setCommitDraft("work", "first changes");
  ui.submitCommitDraft("work", "commit-task", "first changes");
  ui.setCommitDraft("work", "next changes");
  ui.settleCommitDrafts([outcome("succeeded")]);
  expect(useUI.getState().commitDrafts.work).toBe("next changes");
  ui.submitCommitDraft("work", "commit-task", "next changes");
  ui.settleCommitDrafts([outcome("interrupted")]);
  expect(useUI.getState().commitDrafts.work).toBe("next changes");
  expect(useUI.getState().commitSubmissions.work).toBeUndefined();
});
it("counts each task once and clears every unread notification together", () => {
  useUI.getState().markTasksUnread(["first", "second"]);
  useUI.getState().markTasksUnread(["second", "third"]);
  expect(useUI.getState().unreadTaskIds).toEqual(["first", "second", "third"]);
  useUI.getState().markAllTasksRead();
  expect(useUI.getState().unreadTaskIds).toEqual([]);
});
it("keeps only the latest toast without opening or losing task notifications", () => {
  const ui = useUI.getState();
  ui.notifyTask({ ...outcome("succeeded"), id: "first" }, true);
  ui.notifyTask({ ...outcome("failed"), id: "second" }, true);
  expect(useUI.getState().tasksOpen).toBe(false);
  expect(useUI.getState().toastTaskId).toBe("second");
  ui.dismissToast();
  expect(useUI.getState().toastTaskId).toBe("");
  expect(useUI.getState().localTasks.map((t) => t.id)).toEqual(["second", "first"]);
  expect(useUI.getState().unreadTaskIds).toEqual(["first", "second"]);
});
