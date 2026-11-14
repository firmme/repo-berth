// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TaskToast, TASK_TOAST_TIMEOUT } from "./workspace-tools";
import { emptyState, type Task } from "./types";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const task: Task = {
  id: "format", kind: "line_endings", target: "checkout", state: "succeeded",
  progress: "config.json：Mixed → LF（保存文件）", error: "", errorCode: "",
  startedAt: "", finishedAt: "",
};

it("automatically folds a notification away and pauses while the user reads it", () => {
  vi.useFakeTimers();
  const dismiss = vi.fn();
  render(<TaskToast task={task} st={emptyState} revision={1} onDismiss={dismiss} onOpen={vi.fn()} />);
  const toast = screen.getByRole("status", { name: "新消息通知" });
  expect(screen.getByText(task.progress)).toBeTruthy();
  fireEvent.mouseEnter(toast);
  act(() => vi.advanceTimersByTime(TASK_TOAST_TIMEOUT * 2));
  expect(dismiss).not.toHaveBeenCalled();
  fireEvent.mouseLeave(toast);
  act(() => vi.advanceTimersByTime(TASK_TOAST_TIMEOUT));
  expect(dismiss).toHaveBeenCalledTimes(1);
});

it("replaces a notification without letting the old timer dismiss the new message", () => {
  vi.useFakeTimers();
  const dismiss = vi.fn();
  const open = vi.fn();
  const { rerender } = render(<TaskToast task={task} st={emptyState} revision={1} onDismiss={dismiss} onOpen={open} />);
  act(() => vi.advanceTimersByTime(TASK_TOAST_TIMEOUT - 100));
  rerender(<TaskToast task={{ ...task, id: "next", progress: "下一条消息" }} st={emptyState} revision={2} onDismiss={dismiss} onOpen={open} />);
  act(() => vi.advanceTimersByTime(100));
  expect(dismiss).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "查看任务中心" }));
  expect(open).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(TASK_TOAST_TIMEOUT));
  expect(dismiss).toHaveBeenCalledTimes(1);
});
