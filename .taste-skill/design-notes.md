# Repo Berth 0.2 desktop design

The user's explicit GitHub Desktop screenshot supersedes the earlier framed-sheet direction (seed 180996233). This is a requested change of direction, not a random redraw.

- Question: which repository, branch, access account and commit identity am I using, and what will this commit contain?
- Composition: dark menu and repository/branch/fetch/account toolbar; 280px file/history pane; commit form pinned at its bottom; remaining canvas reserved for diff or clean-state actions.
- Multi-account signature: a named account switcher, with per-checkout/remote bindings and separately confirmed commit profiles. Switching copies preserves each draft.
- Face: locally loaded IBM Plex Sans with system CJK fallback. Monospace is restricted to actual Git patch text. Body/actions 13px; metadata 11px.
- Palette: dark neutral chrome, white work area, blue selection/action, red/green only for actual removed/added lines. Account colors supplement names.
- Menus, account management, repository settings, clone and tasks are overlays; the main canvas stays focused on work.
- Existing mark and app icon remain original Repo Berth artwork. No GitHub logo or illustration is copied.
- Empty preview contains no fictitious accounts. Native screenshots use explicitly isolated synthetic accounts and real local Git repositories; no fixture data is shipped.
- Compact windows fold the sidebar when a diff or clean state is shown. No page-level horizontal overflow at 1440/768/390.
- Inspector warnings are reviewed against the native screenshots. Metadata at 11px is deliberate desktop density; menu popovers/dialogs alone have shadows. The code font warning refers to literal patches.
