// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  effectiveCommitIdentity,
  LocalManagement,
  resolveAccessAccount,
  githubRepositoryPath,
} from "./local-management";
import { ImportModal, TaskRow } from "./workspace-tools";
import { emptyState, type Checkout } from "./types";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("./api", () => ({
  api: mocks.api,
  errorMessage: (e: unknown) => String(e),
}));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
beforeEach(() => mocks.api.mockReset());
afterEach(cleanup);
const c: Checkout = {
  id: "plain",
  name: "notes",
  path: "D:/notes",
  repositoryId: "",
  lastOpened: "",
  favorite: false,
  remotes: [],
  plainDirectory: true,
};
const execute = async (fn: () => Promise<unknown>) => {
  await fn();
};

it("shows no ownership trust confirmation for historical scan failures", () => {
  render(
    <TaskRow
      task={{
        id: "old-scan",
        kind: "scan",
        target: "D:/code",
        state: "failed",
        errorCode: "SCAN_PARTIAL",
        error: "旧扫描记录",
        progress: "",
        startedAt: "",
        finishedAt: "",
        scanSummary: {
          imported: 0,
          skipped: 1,
          issues: [{ path: "project", code: "DUBIOUS_OWNERSHIP" }],
        },
      }}
      st={emptyState}
      execute={execute}
      onClone={() => {}}
      onOpenCheckout={() => {}}
    />,
  );
  expect(screen.queryByRole("button", { name: /信任/ })).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("uses the Settings default until a project explicitly overrides it", () => {
  const st = structuredClone(emptyState);
  st.settings.defaultCommitName = "Default";
  st.settings.defaultCommitEmail = "default@example.test";
  const legacy = {
    id: "p",
    accountId: "work",
    name: "Legacy",
    email: "legacy@example.test",
  };
  expect(effectiveCommitIdentity(st, c, legacy)?.name).toBe("Default");
  expect(
    effectiveCommitIdentity(
      st,
      { ...c, commitName: "Project", commitEmail: "project@example.test" },
      legacy,
    )?.name,
  ).toBe("Project");
});

it("prefers per-remote association over the remembered fallback and keeps commit identity independent", () => {
  const personal = {
    id: "personal",
    login: "personal",
    provider: "github",
    host: "github.com",
    userId: 1,
    name: "Personal",
    avatar: "",
    note: "",
    color: "#0969da",
    status: "connected",
    sessionOnly: false,
    syncedAt: "",
  };
  const st = {
    ...structuredClone(emptyState),
    accounts: [personal, { ...personal, id: "work", login: "work" }],
    profiles: [
      {
        id: "author",
        accountId: "personal",
        name: "Author",
        email: "author@example.test",
      },
    ],
    bindings: [
      {
        id: "binding",
        checkoutId: c.id,
        remote: "origin",
        accountId: "work",
        profileId: "author",
        automatic: true,
      },
    ],
  };
  st.settings.defaultAccountId = "personal";
  expect(resolveAccessAccount(st, c, "origin").account?.id).toBe("work");
  expect(resolveAccessAccount(st, c, "origin").source).toBe("自动关联");
  expect(resolveAccessAccount(st, c, "origin").profile?.name).toBe("Author");
  expect(resolveAccessAccount(st, c, "upstream").account?.id).toBe("personal");
  expect(resolveAccessAccount(st, undefined, "").account?.id).toBe("personal");
  expect(githubRepositoryPath("git@github.com:organization/project.git")).toBe(
    "organization/project",
  );
});

it("asks before adding a non-Git directory and requires a second action", async () => {
  mocks.api.mockImplementation(async (name: string) => {
    if (name === "ImportCheckout")
      throw new Error("NOT_REPOSITORY: ordinary directory");
    if (name === "ImportPlainDirectory") return "plain";
    if (name === "Snapshot") return { ...emptyState, checkouts: [c] };
  });
  const imported = vi.fn();
  const user = userEvent.setup();
  render(
    <ImportModal execute={execute} onClose={() => {}} onImported={imported} />,
  );
  await user.type(screen.getByLabelText("目录"), "D:/notes");
  await user.click(screen.getByRole("button", { name: "开始导入" }));
  expect(
    await screen.findByText("这个目录不是 Git 仓库，是否继续添加？"),
  ).toBeTruthy();
  expect(
    mocks.api.mock.calls.some((v) => v[0] === "ImportPlainDirectory"),
  ).toBe(false);
  await user.click(screen.getByRole("button", { name: "继续添加普通目录" }));
  await waitFor(() => expect(imported).toHaveBeenCalledWith("plain", "plain"));
});

it("bulk removal asks for confirmation and sends only selected checkout IDs", async () => {
  const user = userEvent.setup();
  render(
    <LocalManagement
      st={{
        ...emptyState,
        checkouts: [
          c,
          {
            ...c,
            id: "other",
            name: "project",
            path: "D:/project",
            plainDirectory: false,
          },
        ],
      }}
      execute={execute}
      onClose={() => {}}
    />,
  );
  await user.click(screen.getByLabelText(/notes · 普通目录/));
  await user.click(screen.getByRole("button", { name: "移出管理（1）" }));
  expect(mocks.api).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "确认移出管理（1）" }));
  await waitFor(() =>
    expect(mocks.api).toHaveBeenCalledWith("ForgetCheckouts", ["plain"]),
  );
});
