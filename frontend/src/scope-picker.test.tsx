// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScopePicker } from "./scope-picker";
import { AccountAvatar } from "./components";
import { emptyState, type Account } from "./types";
import { vi } from "vitest";
afterEach(cleanup);
const account: Account = {
  id: "work",
  provider: "github",
  host: "github.com",
  userId: 1,
  login: "work",
  name: "Work",
  avatar: "https://avatars.githubusercontent.com/u/1?v=4",
  color: "#0969da",
  note: "工作",
  status: "connected",
  sessionOnly: false,
  syncedAt: "",
};
it("renders the GitHub avatar and falls back to initials if loading fails", () => {
  render(<AccountAvatar account={account} />);
  const img = screen.getByRole("img", { name: "work 的头像" });
  expect(img.getAttribute("src")).toBe(account.avatar);
  fireEvent.error(img);
  expect(screen.queryByRole("img")).toBeNull();
  expect(screen.getByText("WO")).toBeTruthy();
});
it("marks accounts that need authorization with a yellow warning badge", () => {
  render(<AccountAvatar account={{ ...account, status: "auth_required" }} />);
  expect(screen.getByLabelText("需要重新授权")).toBeTruthy();
});
it("does not use an untrusted avatar protocol or host", () => {
  render(
    <AccountAvatar
      account={{ ...account, avatar: "https://other.test/avatar" }}
    />,
  );
  expect(screen.queryByRole("img")).toBeNull();
});
it("shows distinct scope icons and account avatars and supports keyboard selection", async () => {
  const user = userEvent.setup();
  const change = vi.fn();
  render(
    <ScopePicker
      state={{ ...emptyState, accounts: [account] }}
      value="all"
      onChange={change}
    />,
  );
  const trigger = screen.getByRole("button", { name: "按账号或分组筛选" });
  await user.click(trigger);
  expect(
    screen
      .getByRole("menuitemradio", { name: "普通目录" })
      .querySelector("svg"),
  ).toBeTruthy();
  expect(
    screen.getByRole("menuitemradio", { name: /work/ }).querySelector("img"),
  ).toBeTruthy();
  await user.click(screen.getByRole("menuitemradio", { name: "普通目录" }));
  expect(change).toHaveBeenCalledWith("plain");
  expect(screen.queryByRole("menu")).toBeNull();
  trigger.focus();
  await user.keyboard("{ArrowDown}");
  await screen.findByRole("menu");
  await user.keyboard("{End}{Enter}");
  expect(change).toHaveBeenLastCalledWith("account:work");
});

