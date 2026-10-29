import { describe, it, expect } from "vitest";
import { rowsFromState, filterRows } from "./App";
import { emptyState, type State } from "./types";

function fixture(): State {
  return {
    ...structuredClone(emptyState),
    repositories: [
      {
        id: "shared",
        owner: "team",
        name: "project",
        description: "Shared repo",
        cloneUrl: "https://github.com/team/project.git",
        url: "",
        private: true,
        language: "Go",
        updatedAt: "",
        favorite: true,
      },
    ],
    access: [
      {
        id: "a",
        accountId: "personal",
        repositoryId: "shared",
        push: true,
        syncedAt: "",
      },
      {
        id: "b",
        accountId: "work",
        repositoryId: "shared",
        push: true,
        syncedAt: "",
      },
    ],
    checkouts: [
      {
        id: "one",
        name: "project",
        repositoryId: "shared",
        path: "D:/personal/project",
        lastOpened: "2026-10-28T00:00:00Z",
        favorite: false,
        remotes: [],
      },
      {
        id: "two",
        name: "project",
        repositoryId: "shared",
        path: "D:/work/project",
        lastOpened: "2026-10-29T00:00:00Z",
        favorite: false,
        remotes: [],
      },
      {
        id: "local",
        name: "offline",
        repositoryId: "",
        path: "D:/offline",
        lastOpened: "",
        favorite: false,
        remotes: [],
      },
    ],
    groups: [{ id: "group", name: "Work", members: ["shared"] }],
  };
}
describe("repository projection", () => {
  it("merges shared remote access without merging local copies", () => {
    const rows = rowsFromState(fixture());
    expect(rows).toHaveLength(2);
    expect(rows[0].accountIDs).toEqual(["personal", "work"]);
    expect(rows[0].checkouts).toHaveLength(2);
    expect(rows[0].lastOpened).toBe("2026-10-29T00:00:00Z");
  });
  it("combines account, owner, search and visibility filters", () => {
    const st = fixture(),
      rows = rowsFromState(st);
    expect(
      filterRows(rows, "account:work", "D:/work", "team", "private", st),
    ).toHaveLength(1);
    expect(
      filterRows(rows, "account:personal", "", "", "public", st),
    ).toHaveLength(0);
    expect(filterRows(rows, "all", "offline", "", "local", st)[0].id).toBe(
      "local",
    );
  });
  it("uses real favorites, group membership and recent timestamps", () => {
    const st = fixture(),
      rows = rowsFromState(st);
    for (const scope of ["favorite", "group:group", "recent"])
      expect(
        filterRows(rows, scope, "", "", "all", st).map((r) => r.id),
      ).toEqual(["shared"]);
  });
  it("keeps all zero counts honest for first run", () =>
    expect(rowsFromState(emptyState)).toEqual([]));
  it("keeps local identity bindings discoverable after cloud access disappears", () => {
    const st = fixture();
    st.access = st.access.filter((a) => a.accountId !== "work");
    st.bindings = [
      {
        id: "work-origin",
        checkoutId: "two",
        remote: "origin",
        accountId: "work",
        profileId: "profile",
      },
      {
        id: "work-upstream",
        checkoutId: "two",
        remote: "upstream",
        accountId: "work",
        profileId: "profile",
      },
      {
        id: "removed",
        checkoutId: "one",
        remote: "origin",
        accountId: "",
        profileId: "old",
      },
    ];
    const rows = rowsFromState(st);
    expect(rows[0].accountIDs).toEqual(["personal", "work"]);
    expect(
      filterRows(rows, "account:work", "", "", "all", st).map((r) => r.id),
    ).toEqual(["shared"]);
    st.bindings = [];
    expect(
      filterRows(rowsFromState(st), "account:work", "", "", "all", st),
    ).toEqual([]);
  });
  it("deduplicates multiple remote bindings on unassociated local checkouts", () => {
    const st = fixture();
    st.bindings = ["origin", "upstream"].map((remote) => ({
      id: remote,
      checkoutId: "local",
      remote,
      accountId: "work",
      profileId: "profile",
    }));
    expect(rowsFromState(st).find((r) => r.id === "local")?.accountIDs).toEqual(
      ["work"],
    );
  });
});
