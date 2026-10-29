// @vitest-environment jsdom
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AccountsView } from "./settings";
import { RepositoryDetail, CloneForm } from "./repository";
import { DirectoryField } from "./components";
import { emptyState, type State } from "./types";
import type { Execute, Row } from "./App";
import App from "./App";
import { useUI } from "./ui";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("./api", () => ({
  api: mocks.api,
  isDesktop: true,
  onStateChanged: async () => () => {},
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));

const clients: QueryClient[] = [];
function mount(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  );
}
const execute: Execute = async (action) => {
  await action();
};
function fixture(): State {
  return {
    ...structuredClone(emptyState),
    githubAuthConfigured: true,
    settings: { ...emptyState.settings, clientId: "test-client" },
    accounts: [
      {
        id: "personal",
        provider: "github",
        host: "github.com",
        userId: 1,
        login: "personal",
        name: "Personal",
        avatar: "",
        note: "",
        color: "#1b6c80",
        status: "connected",
        sessionOnly: false,
        syncedAt: "",
      },
    ],
    profiles: [
      {
        id: "profile",
        accountId: "personal",
        name: "Chosen Name",
        email: "chosen@example.com", // taste-skill-ignore: reserved test-only address, never rendered by the product
      },
    ],
    checkouts: [
      {
        id: "checkout",
        name: "local-project",
        path: "D:/Projects/local-project",
        repositoryId: "",
        favorite: false,
        lastOpened: "",
        remotes: [
          { name: "origin", url: "https://github.com/org/project.git" },
        ],
      },
    ],
    bindings: [
      {
        id: "binding",
        checkoutId: "checkout",
        remote: "origin",
        accountId: "personal",
        profileId: "profile",
      },
    ],
  };
}

beforeAll(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
beforeEach(() => {
  useUI.getState().set({
    view: "repositories",
    scope: "all",
    selected: "",
    query: "",
    tasksOpen: false,
    menuOpen: false,
    commitDrafts: {},
    commitSubmissions: {},
  });
  mocks.api.mockReset();
  mocks.api.mockImplementation(async (name: string) => {
    if (name === "AccountEmails")
      return [{ email: "chosen@example.com", verified: true, primary: true }]; // taste-skill-ignore: mocked test-only API response
    if (name === "GitStatus")
      return {
        branch: "main",
        upstream: "",
        ahead: 0,
        behind: 0,
        files: [],
        remotes: [
          {
            name: "origin",
            url: "https://github.com/org/project.git",
            pushUrl: "https://github.com/org/project.git",
          },
        ],
        detached: false,
      };
    return undefined;
  });
});
afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.length = 0;
});

describe("identity maintenance", () => {
  it("edits the chosen profile ID only after explicit confirmation", async () => {
    const user = userEvent.setup();
    mount(<AccountsView st={fixture()} execute={execute} />);
    await user.click(screen.getByRole("button", { name: "编辑" }));
    const dialog = screen.getByRole("dialog", {
      name: "确认 personal 的提交身份",
    });
    const name = within(dialog).getByRole("textbox", { name: "提交姓名" });
    expect((name as HTMLInputElement).value).toBe("Chosen Name");
    await user.clear(name);
    await user.type(name, "Updated Name");
    const save = within(dialog).getByRole("button", {
      name: "保存身份",
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: "我已确认此姓名和邮箱用于 Git 提交",
      }),
    );
    await user.click(save);
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith("SaveProfile", {
        id: "profile",
        accountId: "personal",
        name: "Updated Name",
        email: "chosen@example.com", // taste-skill-ignore: assertion for the test-only profile above
      }),
    );
  });
  it("does not delete an identity still bound to a checkout", async () => {
    const user = userEvent.setup();
    mount(<AccountsView st={fixture()} execute={execute} />);
    await user.click(screen.getByRole("button", { name: "编辑" }));
    const remove = screen.getByRole("button", {
      name: /删除身份/,
    }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    await user.click(remove);
    expect(
      mocks.api.mock.calls.some(([name]) => name === "DeleteProfile"),
    ).toBe(false);
  });
  it("can remove an unused identity without removing its account", async () => {
    const state = fixture();
    state.bindings = [];
    const user = userEvent.setup();
    mount(<AccountsView st={state} execute={execute} />);
    await user.click(screen.getByRole("button", { name: "编辑" }));
    await user.click(screen.getByRole("button", { name: "删除身份" }));
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith("DeleteProfile", "profile"),
    );
    expect(
      mocks.api.mock.calls.some(([name]) => name === "RemoveAccount"),
    ).toBe(false);
  });
});

describe("local checkout maintenance", () => {
  function detail(onBack = vi.fn()) {
    const state = fixture();
    const checkout = state.checkouts[0];
    const row: Row = {
      id: checkout.id,
      name: checkout.name,
      owner: "本地仓库",
      description: checkout.path,
      checkouts: [checkout],
      accountIDs: ["personal"],
      favorite: false,
      lastOpened: "",
    };
    mount(
      <RepositoryDetail
        row={row}
        st={state}
        execute={execute}
        onClone={vi.fn()}
        onBack={onBack}
      />,
    );
    return onBack;
  }
  it("requires a named confirmation before forgetting a checkout", async () => {
    const user = userEvent.setup();
    const onBack = detail();
    await user.click(screen.getByRole("button", { name: "移出管理" }));
    const dialog = screen.getByRole("dialog", {
      name: "将此本地副本移出管理？",
    });
    expect(
      within(dialog).getByText(/不会删除文件、目录或 Git 提交/),
    ).toBeTruthy();
    expect(
      mocks.api.mock.calls.some(([name]) => name === "ForgetCheckout"),
    ).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "移出管理" }));
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith("ForgetCheckout", "checkout"),
    );
    expect(onBack).toHaveBeenCalledOnce();
  });
  it("cancel leaves the checkout managed", async () => {
    const user = userEvent.setup();
    detail();
    await user.click(screen.getByRole("button", { name: "移出管理" }));
    const dialog = screen.getByRole("dialog", {
      name: "将此本地副本移出管理？",
    });
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      mocks.api.mock.calls.some(([name]) => name === "ForgetCheckout"),
    ).toBe(false);
  });
  it("directory picker errors are shown without an unhandled rejection", async () => {
    mocks.api.mockRejectedValueOnce(new Error("目录选择失败"));
    const user = userEvent.setup();
    mount(<DirectoryField value="" onChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "选择目录" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "目录选择失败",
    );
  });
});

describe("authorization recovery", () => {
  const auth = {
    taskId: "failed-auth",
    userCode: "TEST-CODE",
    verificationUri: "https://github.com/login/device",
    expiresIn: 600,
  };
  function recoveryState() {
    const state = fixture();
    state.tasks = [
      {
        id: auth.taskId,
        kind: "authorize",
        target: "",
        state: "failed",
        progress: "",
        errorCode: "VAULT_UNAVAILABLE",
        error: "系统凭据库暂不可用",
        startedAt: "2026-10-29T00:00:00Z",
        finishedAt: "2026-10-29T00:00:01Z",
        canResumeAuthorization: true,
        authorizationRecoveryExpiresAt: "2026-10-29T00:10:01Z",
      },
    ];
    return state;
  }
  function mockAuth() {
    mocks.api.mockImplementation(async (name: string) => {
      if (name === "StartAuthorization") return auth;
      if (name === "RecoverAuthorization") return "recovered-auth";
      if (name === "AccountEmails") return [];
      return undefined;
    });
  }
  it("requires an explicit session-only choice and reuses browser authorization", async () => {
    mockAuth();
    const user = userEvent.setup();
    mount(<AccountsView st={recoveryState()} execute={execute} />);
    await user.click(screen.getByRole("button", { name: "添加 GitHub 账号" }));
    const dialog = await screen.findByRole("dialog", {
      name: "确认 GitHub 授权",
    });
    expect(within(dialog).getByText("浏览器授权已完成")).toBeTruthy();
    expect(
      mocks.api.mock.calls.some(([name]) => name === "RecoverAuthorization"),
    ).toBe(false);
    await user.click(
      within(dialog).getByRole("button", { name: "仅本次会话保存" }),
    );
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(
        "RecoverAuthorization",
        "failed-auth",
        true,
      ),
    );
    expect(
      mocks.api.mock.calls.filter(([name]) => name === "StartAuthorization"),
    ).toHaveLength(1);
  });
  it("can retry persistent saving without silently selecting session mode", async () => {
    mockAuth();
    const user = userEvent.setup();
    mount(<AccountsView st={recoveryState()} execute={execute} />);
    await user.click(screen.getByRole("button", { name: "添加 GitHub 账号" }));
    await user.click(
      await screen.findByRole("button", { name: "重新保存到系统凭据库" }),
    );
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(
        "RecoverAuthorization",
        "failed-auth",
        false,
      ),
    );
  });
  it("discard explicitly cancels the retained authorization", async () => {
    mockAuth();
    const user = userEvent.setup();
    mount(<AccountsView st={recoveryState()} execute={execute} />);
    await user.click(screen.getByRole("button", { name: "添加 GitHub 账号" }));
    await user.click(
      await screen.findByRole("button", { name: "取消并丢弃本次授权" }),
    );
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith("CancelTask", "failed-auth"),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("shows deferred cleanup and exposes a retry without changing accounts", async () => {
    const state = fixture();
    state.pendingCredentialCleanupCount = 2;
    const user = userEvent.setup();
    mount(<AccountsView st={state} execute={execute} />);
    expect(screen.getByRole("status").textContent).toContain("2 项旧凭据");
    await user.click(screen.getByRole("button", { name: "重试清理旧凭据" }));
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith("RetryCredentialCleanup"),
    );
    expect(
      mocks.api.mock.calls.some(([name]) => name === "RemoveAccount"),
    ).toBe(false);
  });
  it("uses the successfully authorized account when opening identity confirmation", async () => {
    mockAuth();
    const state = recoveryState();
    state.accounts.push({
      ...state.accounts[0],
      id: "work",
      login: "work",
      name: "Work Name",
      userId: 2,
    });
    state.tasks[0] = {
      ...state.tasks[0],
      state: "succeeded",
      target: "work",
      canResumeAuthorization: false,
    };
    const user = userEvent.setup();
    mount(<AccountsView st={state} execute={execute} />);
    await user.click(screen.getByRole("button", { name: "添加 GitHub 账号" }));
    await user.click(
      await screen.findByRole("button", { name: "设置提交身份" }),
    );
    const dialog = screen.getByRole("dialog", { name: "确认 work 的提交身份" });
    expect(
      (
        within(dialog).getByRole("textbox", {
          name: "提交姓名",
        }) as HTMLInputElement
      ).value,
    ).toBe("Work Name");
  });
  it("does not keep showing expired device codes as an actionable login", async () => {
    mockAuth();
    const state = recoveryState();
    state.tasks[0].canResumeAuthorization = false;
    const user = userEvent.setup();
    mount(<AccountsView st={state} execute={execute} />);
    await user.click(screen.getByRole("button", { name: "添加 GitHub 账号" }));
    expect(
      await screen.findByRole("button", { name: "重新打开浏览器授权" }),
    ).toBeTruthy();
    expect(screen.queryByText(auth.userCode)).toBeNull();
  });
});
describe("multiple local copies", () => {
  function multiState() {
    const state = fixture();
    state.repositories = [
      {
        id: "shared",
        owner: "org",
        name: "project",
        description: "",
        cloneUrl: "https://github.com/org/project.git",
        url: "https://github.com/org/project",
        private: true,
        language: "Go",
        updatedAt: "",
        favorite: false,
      },
    ];
    state.checkouts[0].repositoryId = "shared";
    state.checkouts.push({
      ...state.checkouts[0],
      id: "work-copy",
      path: "D:/Work/project",
      name: "work-project",
    });
    state.bindings.push({
      ...state.bindings[0],
      id: "work-binding",
      checkoutId: "work-copy",
    });
    return state;
  }
  it("explains missing cloud access while keeping the bound local copy available", async () => {
    const state = multiState();
    const row: Row = {
      id: "shared",
      name: "project",
      owner: "org",
      description: "",
      repository: state.repositories[0],
      checkouts: state.checkouts,
      accountIDs: ["personal"],
      favorite: false,
      lastOpened: "",
    };
    mount(
      <RepositoryDetail
        row={row}
        st={state}
        execute={execute}
        onClone={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("最近的同步列表");
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Fetch" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect((screen.getByLabelText("本地副本") as HTMLSelectElement).value).toBe(
      "checkout",
    );
  });
  it("does not silently switch identities when the selected remote disappears", async () => {
    const state = multiState();
    state.accounts.push({
      ...state.accounts[0],
      id: "work",
      login: "work",
      userId: 2,
    });
    state.profiles.push({
      id: "work-profile",
      accountId: "work",
      name: "Work Name",
      email: "work@example.test",
    });
    state.bindings.push({
      id: "upstream-binding",
      checkoutId: "checkout",
      remote: "upstream",
      accountId: "work",
      profileId: "work-profile",
    });
    const allRemotes = ["origin", "upstream"].map((name) => ({
      name,
      url: state.repositories[0].cloneUrl,
      pushUrl: state.repositories[0].cloneUrl,
    }));
    let remotes = allRemotes;
    mocks.api.mockImplementation(async (name: string) =>
      name === "GitStatus"
        ? {
            branch: "main",
            upstream: "",
            ahead: 0,
            behind: 0,
            detached: false,
            files: [],
            remotes,
          }
        : undefined,
    );
    const row: Row = {
      id: "shared",
      name: "project",
      owner: "org",
      description: "",
      repository: state.repositories[0],
      checkouts: state.checkouts,
      accountIDs: ["personal", "work"],
      favorite: false,
      lastOpened: "",
    };
    const user = userEvent.setup();
    mount(
      <RepositoryDetail
        row={row}
        st={state}
        execute={execute}
        onClone={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(
      (screen.getByRole("button", { name: "Fetch" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Fetch" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    remotes = allRemotes.filter((r) => r.name !== "origin");
    await user.click(screen.getByRole("button", { name: "刷新仓库状态" }));
    await screen.findByText(/remote「origin」当前不存在/);
    expect(
      (screen.getByLabelText("选择 remote") as HTMLSelectElement).value,
    ).toBe("");
    for (const name of ["Fetch", "Pull", "Push"])
      expect(
        (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(true);
    expect(screen.queryByText("Work Name")).toBeNull();
    await user.selectOptions(screen.getByLabelText("选择 remote"), "upstream");
    expect(screen.getByText("Work Name")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Fetch" }));
    expect(mocks.api).toHaveBeenCalledWith(
      "GitNetwork",
      "checkout",
      "upstream",
      "fetch",
    );
  });
  it("opens the copy and remote bound to the account being filtered", async () => {
    const state = multiState();
    state.accounts.push({
      ...state.accounts[0],
      id: "work",
      login: "work",
      name: "Work",
      userId: 2,
    });
    state.profiles.push({
      id: "work-profile",
      accountId: "work",
      name: "Work Name",
      email: "work@example.test",
    });
    state.bindings[1] = {
      ...state.bindings[1],
      accountId: "work",
      profileId: "work-profile",
      remote: "upstream",
    };
    const remotes = ["origin", "upstream"].map((name) => ({
      name,
      url: state.repositories[0].cloneUrl,
      pushUrl: state.repositories[0].cloneUrl,
    }));
    mocks.api.mockImplementation(async (name: string) =>
      name === "Snapshot"
        ? state
        : name === "GitVersion"
          ? "git version 2.49.0"
          : name === "GitStatus"
            ? {
                branch: "main",
                upstream: "",
                ahead: 0,
                behind: 0,
                detached: false,
                files: [],
                remotes,
              }
            : undefined,
    );
    useUI.getState().set({ scope: "account:work" });
    const user = userEvent.setup();
    mount(<App />);
    await user.click(await screen.findByRole("button", { name: /当前仓库/ }));
    const row = await screen.findByRole("button", {
      name: /D:\/Work\/project/,
    });
    await user.click(row);
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith("GitStatus", "work-copy"),
    );
    expect(screen.getByRole("button", { name: /Fetch upstream/ })).toBeTruthy();
    expect(screen.getByText("Work Name")).toBeTruthy();
    expect(
      mocks.api.mock.calls.some(
        ([name]) => name === "BindRepository" || name === "GitNetwork",
      ),
    ).toBe(false);
  });
  it("offers account management for expired authorization without blocking local changes", async () => {
    const state = multiState();
    state.accounts[0].status = "auth_required";
    const row: Row = {
      id: "shared",
      name: "project",
      owner: "org",
      description: "",
      repository: state.repositories[0],
      checkouts: state.checkouts,
      accountIDs: ["personal"],
      favorite: false,
      lastOpened: "",
    };
    const user = userEvent.setup();
    mount(
      <RepositoryDetail
        row={row}
        st={state}
        execute={execute}
        onClone={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("需要重新授权");
    for (const name of ["Fetch", "Pull", "Push"])
      expect(
        (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(true);
    expect(
      (screen.getByRole("tab", { name: "变更" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    await user.click(screen.getByRole("button", { name: "管理账号授权" }));
    expect(useUI.getState().view).toBe("accounts");
  });
  it("isolates selected diffs and preserves separate commit drafts when switching copies", async () => {
    const state = multiState();
    mocks.api.mockImplementation(async (name: string, id: string) => {
      if (name === "GitStatus")
        return {
          branch: "main",
          upstream: "",
          ahead: 0,
          behind: 0,
          detached: false,
          remotes: [
            {
              name: "origin",
              url: state.repositories[0].cloneUrl,
              pushUrl: state.repositories[0].cloneUrl,
            },
          ],
          files: [
            {
              path: id === "checkout" ? "personal.txt" : "work.txt",
              originalPath: "",
              index: "M",
              worktree: " ",
            },
          ],
        };
      if (name === "GitDiff") return "test file changes";
      return undefined;
    });
    const row: Row = {
      id: "shared",
      name: "project",
      owner: "org",
      description: "",
      repository: state.repositories[0],
      checkouts: state.checkouts,
      accountIDs: ["personal"],
      favorite: false,
      lastOpened: "",
    };
    const user = userEvent.setup();
    mount(
      <RepositoryDetail
        row={row}
        st={state}
        execute={execute}
        onClone={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("tab", { name: "变更" }));
    await user.click(
      await screen.findByRole("button", { name: /personal.txt/ }),
    );
    await user.type(screen.getByLabelText("提交信息"), "personal draft");
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(
        "GitDiff",
        "checkout",
        "personal.txt",
        true,
      ),
    );
    await user.selectOptions(screen.getByLabelText("本地副本"), "work-copy");
    await screen.findByRole("button", { name: /work.txt/ });
    expect(
      (screen.getByLabelText("提交信息") as HTMLTextAreaElement).value,
    ).toBe("");
    expect(screen.queryByRole("heading", { name: "personal.txt" })).toBeNull();
    expect(mocks.api).not.toHaveBeenCalledWith(
      "GitDiff",
      "work-copy",
      "personal.txt",
      true,
    );
    await user.type(screen.getByLabelText("提交信息"), "work draft");
    await user.selectOptions(screen.getByLabelText("本地副本"), "checkout");
    expect(
      (screen.getByLabelText("提交信息") as HTMLTextAreaElement).value,
    ).toBe("personal draft");
    expect(useUI.getState().commitDrafts["work-copy"]).toBe("work draft");
  });
  it("opens the exact local copy from a failed task and clears obstructing filters", async () => {
    const state = multiState();
    state.tasks = [
      {
        id: "failed-push",
        kind: "push",
        target: "work-copy",
        state: "failed",
        progress: "",
        errorCode: "AUTH_REQUIRED",
        error: "授权失效",
        startedAt: new Date().toISOString(),
        finishedAt: "",
      },
    ];
    mocks.api.mockImplementation(async (name: string) =>
      name === "Snapshot"
        ? state
        : name === "GitVersion"
          ? "git version 2.49.0"
          : name === "GitStatus"
            ? {
                branch: "main",
                upstream: "",
                ahead: 0,
                behind: 0,
                detached: false,
                files: [],
                remotes: [],
              }
            : undefined,
    );
    useUI
      .getState()
      .set({ tasksOpen: true, scope: "favorite", query: "unmatched filter" });
    const user = userEvent.setup();
    mount(<App />);
    await user.click(
      await screen.findByRole("button", { name: "查看本地副本" }),
    );
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith("GitStatus", "work-copy"),
    );
    expect(screen.getByText("D:/Work/project")).toBeTruthy();
    expect(useUI.getState().scope).toBe("all");
    expect(useUI.getState().query).toBe("");
    expect(
      screen.queryByRole("complementary", { name: "任务中心" }),
    ).toBeNull();
    expect(
      mocks.api.mock.calls.some(
        ([name]) => name === "GitNetwork" || name === "CommitChanges",
      ),
    ).toBe(false);
  });
});
describe("clone retry confirmation", () => {
  function cloneState() {
    const state = fixture();
    state.checkouts = [];
    state.bindings = [];
    state.accounts.push({
      ...state.accounts[0],
      id: "work",
      login: "work",
      userId: 2,
    });
    state.profiles.push({
      id: "work-profile",
      accountId: "work",
      name: "Work Name",
      email: "work@example.test",
    });
    state.repositories = [
      {
        id: "remote",
        owner: "org",
        name: "project",
        description: "",
        cloneUrl: "https://github.com/org/project.git",
        url: "https://github.com/org/project",
        private: true,
        language: "Go",
        updatedAt: "",
        favorite: false,
      },
    ];
    state.access = state.accounts.map((a) => ({
      id: a.id,
      accountId: a.id,
      repositoryId: "remote",
      push: true,
      syncedAt: "",
    }));
    return state;
  }
  const request = {
    accountId: "work",
    profileId: "work-profile",
    destination: "D:\\工作目录\\chosen checkout",
  };
  it("prefers the filtered account for a new clone without replacing retry context", () => {
    const state = cloneState();
    mount(
      <CloneForm
        repository={state.repositories[0]}
        st={state}
        execute={execute}
        onDone={vi.fn()}
        preferredAccountID="work"
      />,
    );
    expect((screen.getByLabelText("访问账号") as HTMLSelectElement).value).toBe(
      "work",
    );
    expect((screen.getByLabelText("提交身份") as HTMLSelectElement).value).toBe(
      "work-profile",
    );
  });
  it("requires an explicit account choice if the filtered account has no cloud access record", () => {
    const state = cloneState();
    state.access = state.access.filter((a) => a.accountId !== "work");
    mount(
      <CloneForm
        repository={state.repositories[0]}
        st={state}
        execute={execute}
        onDone={vi.fn()}
        preferredAccountID="work"
      />,
    );
    expect((screen.getByLabelText("访问账号") as HTMLSelectElement).value).toBe(
      "",
    );
    expect(
      (screen.getByRole("button", { name: "开始克隆" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText(/当前筛选的账号尚无此仓库的访问记录/)).toBeTruthy();
  });
  it("restores the second account and the exact chosen destination for confirmation", async () => {
    const state = cloneState();
    const user = userEvent.setup();
    mount(
      <CloneForm
        repository={state.repositories[0]}
        st={state}
        execute={execute}
        onDone={vi.fn()}
        initial={request}
      />,
    );
    expect((screen.getByLabelText("访问账号") as HTMLSelectElement).value).toBe(
      "work",
    );
    expect((screen.getByLabelText("提交身份") as HTMLSelectElement).value).toBe(
      "work-profile",
    );
    expect(
      (screen.getByLabelText("克隆父目录") as HTMLInputElement).value,
    ).toBe("D:\\工作目录");
    expect(
      (screen.getByLabelText("新建目录名称") as HTMLInputElement).value,
    ).toBe("chosen checkout");
    expect(mocks.api).not.toHaveBeenCalledWith(
      "CloneRepository",
      expect.anything(),
    );
    await user.click(screen.getByRole("button", { name: "开始克隆" }));
    expect(mocks.api).toHaveBeenCalledWith(
      "CloneRepository",
      "remote",
      "work",
      "work-profile",
      "D:\\工作目录/chosen checkout",
    );
  });
  it("requires a new selection when the saved profile was removed", async () => {
    const state = cloneState();
    state.profiles = state.profiles.filter((p) => p.id !== "work-profile");
    state.profiles.push({
      id: "replacement",
      accountId: "work",
      name: "Other",
      email: "other@example.test",
    });
    const user = userEvent.setup();
    mount(
      <CloneForm
        repository={state.repositories[0]}
        st={state}
        execute={execute}
        onDone={vi.fn()}
        initial={request}
      />,
    );
    expect((screen.getByLabelText("提交身份") as HTMLSelectElement).value).toBe(
      "",
    );
    expect(
      (screen.getByRole("button", { name: "开始克隆" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await user.selectOptions(screen.getByLabelText("提交身份"), "replacement");
    expect(
      (screen.getByRole("button", { name: "开始克隆" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
  it("does not switch to the first account when the original account was removed", () => {
    const state = cloneState();
    state.accounts = state.accounts.filter((a) => a.id !== "work");
    mount(
      <CloneForm
        repository={state.repositories[0]}
        st={state}
        execute={execute}
        onDone={vi.fn()}
        initial={request}
      />,
    );
    expect((screen.getByLabelText("访问账号") as HTMLSelectElement).value).toBe(
      "",
    );
    expect(
      (screen.getByRole("button", { name: "开始克隆" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
  it("passes persisted task context through the task center into the clone dialog", async () => {
    const state = cloneState();
    state.tasks = [
      {
        id: "failed-clone",
        kind: "clone",
        target: "remote",
        state: "failed",
        progress: "",
        errorCode: "AUTH_REQUIRED",
        error: "需重新授权",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        cloneRequest: request,
      },
    ];
    mocks.api.mockImplementation(async (name: string) =>
      name === "Snapshot"
        ? state
        : name === "GitVersion"
          ? "git version 2.49.0"
          : undefined,
    );
    useUI.getState().set({ tasksOpen: true });
    const user = userEvent.setup();
    mount(<App />);
    await user.click(await screen.findByRole("button", { name: "重试" }));
    const dialog = screen.getByRole("dialog", { name: "克隆仓库" });
    expect(
      (within(dialog).getByLabelText("访问账号") as HTMLSelectElement).value,
    ).toBe("work");
    expect(
      (within(dialog).getByLabelText("新建目录名称") as HTMLInputElement).value,
    ).toBe("chosen checkout");
  });
});
describe("first launch", () => {
  it("shows scan partial results and retries the same directory without hiding imported copies", async () => {
    const state = fixture();
    state.tasks = [
      {
        id: "scan",
        kind: "scan",
        target: "D:/Work",
        state: "failed",
        progress: "",
        errorCode: "SCAN_PARTIAL",
        error: "部分目录无法导入",
        startedAt: new Date().toISOString(),
        finishedAt: "",
        scanSummary: {
          imported: 2,
          skipped: 1,
          issues: [{ path: "bad-git", code: "NOT_REPOSITORY" }],
        },
      },
    ];
    mocks.api.mockImplementation(async (name: string) =>
      name === "Snapshot"
        ? state
        : name === "GitVersion"
          ? "git version 2.49.0"
          : undefined,
    );
    useUI.getState().set({ tasksOpen: true });
    const user = userEvent.setup();
    mount(<App />);
    await user.click(await screen.findByText("扫描结果：导入/更新 2，跳过 1"));
    expect(screen.getByText(/bad-git · 不是有效的 Git 仓库/)).toBeTruthy();
    expect(screen.getByText(/已导入的记录已保留/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(mocks.api).toHaveBeenCalledWith("ScanDirectory", "D:/Work");
  });
  it("reports an incomplete application build without asking users to register OAuth apps", async () => {
    mocks.api.mockImplementation(async (name: string) =>
      name === "Snapshot"
        ? structuredClone(emptyState)
        : name === "GitVersion"
          ? "git version 2.49.0"
          : undefined,
    );
    const user = userEvent.setup();
    mount(<App />);
    await user.click(
      await screen.findByRole("button", {
        name: "添加 GitHub 账号",
      }),
    );
    const dialog = screen.getByRole("dialog", { name: "账号与身份" });
    expect(
      within(dialog).getByText("此构建的 GitHub 登录暂不可用"),
    ).toBeTruthy();
    expect(screen.queryByLabelText("OAuth Client ID")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "配置 GitHub 授权" }),
    ).toBeNull();
  });
  it("reports an unusable Git environment instead of claiming readiness", async () => {
    mocks.api.mockImplementation(async (name: string) => {
      if (name === "Snapshot") return structuredClone(emptyState);
      if (name === "GitVersion") throw new Error("GIT_MISSING: 未找到 Git");
      return undefined;
    });
    mount(<App />);
    expect(await screen.findByText(/Git 不可用/)).toBeTruthy();
    expect(screen.queryByText("本地工作空间已就绪")).toBeNull();
    expect(
      screen.getByRole("button", { name: "设置" }),
    ).toBeTruthy();
  });
});
