// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GitRecoveryModal } from "./git-recovery";
import type { Checkout, RecoveryPlan, RecoveryRequest } from "./types";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("./api", () => ({ api: mocks.api, errorMessage: (e: unknown) => String(e) }));
const request: RecoveryRequest = { kind: "discard", paths: [], all: true, includeUntracked: false, target: "", mode: "mixed" };
const plan: RecoveryPlan = { head: "a".repeat(40), target: "", branch: "main", commits: 0, files: [{ path: "one.txt", action: "restore" }], fingerprint: "preview-hash" };
const clients: QueryClient[] = [];
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
function mount(initialRequest = request) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  const onApplied = vi.fn(async () => {}), onClose = vi.fn();
  render(<QueryClientProvider client={client}><GitRecoveryModal checkout={{ id: "checkout", name: "project" } as Checkout} initialRequest={initialRequest} onApplied={onApplied} onClose={onClose} /></QueryClientProvider>);
  return { onApplied, onClose };
}
beforeEach(() => { mocks.api.mockReset(); mocks.api.mockImplementation(async (name: string) => name === "PreviewGitRecovery" ? plan : undefined); });
afterEach(() => { cleanup(); clients.forEach((c) => c.clear()); clients.length = 0; });

it("previews all changes without deleting untracked files and requires explicit confirmation", async () => {
  const user = userEvent.setup(); const { onApplied } = mount();
  await screen.findByText("one.txt");
  expect(mocks.api).toHaveBeenCalledWith("PreviewGitRecovery", "checkout", request);
  const apply = screen.getByRole("button", { name: "确认丢弃修改" }) as HTMLButtonElement;
  expect(apply.disabled).toBe(true);
  expect((screen.getByRole("checkbox", { name: "同时删除范围内未跟踪的新文件" }) as HTMLInputElement).checked).toBe(false);
  await user.click(screen.getByRole("checkbox", { name: /我确认丢弃/ }));
  await user.click(apply);
  await waitFor(() => expect(onApplied).toHaveBeenCalled());
  expect(mocks.api).toHaveBeenCalledWith("ApplyGitRecovery", "checkout", request, "preview-hash");
});

it("refreshes the preview and requires new confirmation when including untracked files", async () => {
  mocks.api.mockImplementation(async (name: string, _id: string, req: RecoveryRequest) => name === "PreviewGitRecovery" ? req.includeUntracked ? { ...plan, fingerprint: "with-new", files: [...plan.files, { path: "new.txt", action: "delete" }] } : plan : undefined);
  const user = userEvent.setup(); mount(); await screen.findByText("one.txt");
  await user.click(screen.getByRole("checkbox", { name: /我确认丢弃/ }));
  await user.click(screen.getByRole("checkbox", { name: "同时删除范围内未跟踪的新文件" }));
  await screen.findByText("new.txt");
  expect((screen.getByRole("button", { name: "确认丢弃修改" }) as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.api.mock.calls.some(([name]) => name === "ApplyGitRecovery")).toBe(false);
});

it("defaults history reset to mixed, and hard requires destructive confirmation", async () => {
  const user = userEvent.setup(); mount({ ...request, kind: "reset", all: false, target: "b".repeat(40) });
  await screen.findByText("one.txt");
  expect((screen.getByRole("radio", { name: /Mixed/ }) as HTMLInputElement).checked).toBe(true);
  await user.click(screen.getByRole("radio", { name: /Hard/ }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledWith("PreviewGitRecovery", "checkout", expect.objectContaining({ kind: "reset", mode: "hard" })));
  expect((screen.getByRole("button", { name: "确认重置" }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole("checkbox", { name: /我确认丢弃/ }));
  await waitFor(() => expect((screen.getByRole("button", { name: "确认重置" }) as HTMLButtonElement).disabled).toBe(false));
  await user.click(screen.getByRole("button", { name: "确认重置" }));
  expect(mocks.api).toHaveBeenCalledWith("ApplyGitRecovery", "checkout", expect.objectContaining({ mode: "hard" }), "preview-hash");
});

it("does not silently retry a destructive operation when the preview became stale", async () => {
  let count = 0;
  mocks.api.mockImplementation(async (name: string) => {
    if (name === "ApplyGitRecovery") throw new Error("RECOVERY_CHANGED: 请重新预览");
    return { ...plan, fingerprint: `preview-${++count}` };
  });
  const user = userEvent.setup(); mount(); await screen.findByText("one.txt");
  await user.click(screen.getByRole("checkbox", { name: /我确认丢弃/ })); await user.click(screen.getByRole("button", { name: "确认丢弃修改" }));
  await screen.findByText(/RECOVERY_CHANGED/);
  await waitFor(() => expect(count).toBe(2));
  expect(mocks.api.mock.calls.filter(([name]) => name === "ApplyGitRecovery")).toHaveLength(1);
  expect((screen.getByRole("button", { name: "确认丢弃修改" }) as HTMLButtonElement).disabled).toBe(true);
});

it("keeps the confirmation open while the Git operation is running", async () => {
  let finish!: () => void;
  const operation = new Promise<void>((resolve) => { finish = resolve; });
  mocks.api.mockImplementation(async (method: string) => method === "ApplyGitRecovery" ? operation : plan);
  const user = userEvent.setup();
  const { onClose } = mount();
  await screen.findByText("one.txt");
  await user.click(screen.getByRole("checkbox", { name: /我确认丢弃/ }));
  await user.click(screen.getByRole("button", { name: "确认丢弃修改" }));
  const dialog = await screen.findByRole("dialog");
  const cancel = new Event("cancel", { cancelable: true });
  expect(fireEvent(dialog, cancel)).toBe(false);
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "关闭" }).disabled).toBe(true);
  finish();
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});
