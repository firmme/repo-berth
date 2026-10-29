import type { State, Repository, Checkout } from "./types";
export type Execute = (fn: () => Promise<unknown>) => Promise<void>;
export type Row = {
  id: string;
  name: string;
  owner: string;
  description: string;
  repository?: Repository;
  checkouts: Checkout[];
  accountIDs: string[];
  favorite: boolean;
  lastOpened: string;
};
export function rowsFromState(st: State): Row[] {
  const rows: Row[] = st.repositories.map((r) => ({
    id: r.id,
    name: r.name,
    owner: r.owner,
    description: r.description,
    repository: r,
    checkouts: st.checkouts.filter((c) => c.repositoryId === r.id),
    accountIDs: [
      ...new Set(
        [
          ...st.access
            .filter((a) => a.repositoryId === r.id)
            .map((a) => a.accountId),
          ...st.bindings
            .filter((b) =>
              st.checkouts.some(
                (c) => c.id === b.checkoutId && c.repositoryId === r.id,
              ),
            )
            .map((b) => b.accountId),
        ].filter(Boolean),
      ),
    ],
    favorite: r.favorite,
    lastOpened: st.checkouts
      .filter((c) => c.repositoryId === r.id)
      .reduce(
        (date, c) => (date > c.lastOpened ? date : c.lastOpened),
        r.lastOpened || "",
      ),
  }));
  for (const c of st.checkouts)
    if (!st.repositories.some((r) => r.id === c.repositoryId))
      rows.push({
        id: c.id,
        name: c.name,
        owner: "本地仓库",
        description: c.path,
        checkouts: [c],
        accountIDs: [
          ...new Set(
            st.bindings
              .filter((b) => b.checkoutId === c.id)
              .map((b) => b.accountId)
              .filter(Boolean),
          ),
        ],
        favorite: c.favorite,
        lastOpened: c.lastOpened,
      });
  rows.sort((a, b) => {
    const aUsed = a.lastOpened || "";
    const bUsed = b.lastOpened || "";
    if (aUsed !== bUsed) return bUsed.localeCompare(aUsed);
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`);
  });
  return rows;
}
export function filterRows(
  rows: Row[],
  scope: string,
  query: string,
  owner: string,
  visibility: string,
  st: State,
): Row[] {
  const words = query.trim().toLocaleLowerCase();
  return rows.filter(
    (r) =>
      (!words ||
        `${r.owner}/${r.name} ${r.description} ${r.checkouts.map((c) => c.path).join(" ")}`
          .toLocaleLowerCase()
          .includes(words)) &&
      (scope === "all" ||
        (scope === "favorite" && r.favorite) ||
        (scope === "local" && r.checkouts.some((c) => !c.plainDirectory)) ||
        (scope === "plain" && r.checkouts.some((c) => c.plainDirectory)) ||
        (scope === "cloud" && !!r.repository) ||
        (scope === "recent" && Boolean(r.lastOpened)) ||
        (scope.startsWith("account:") &&
          r.accountIDs.includes(scope.slice(8))) ||
        (scope.startsWith("group:") &&
          Boolean(
            st.groups
              .find((g) => g.id === scope.slice(6))
              ?.members.includes(r.id),
          ))) &&
      (!owner || r.owner === owner) &&
      (visibility === "all" ||
        (visibility === "local" && r.checkouts.length > 0) ||
        (visibility === "private" && r.repository?.private) ||
        (visibility === "public" && r.repository && !r.repository.private)),
  );
}
