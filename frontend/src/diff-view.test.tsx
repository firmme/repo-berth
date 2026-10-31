// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { DiffViewer, SplitDiffView } from "./diff-view";

afterEach(cleanup);

it("applies the wrap class to unified history diffs", () => {
  const { container } = render(
    <DiffViewer
      text={"diff --git a/a b/a\n@@ -1 +1 @@\n-old\n+new"}
      wordWrap
    />,
  );
  expect(container.querySelector(".desktop-diff.wrap")).toBeTruthy();
});

it("renders side-by-side diff rows", () => {
  const { container } = render(
    <SplitDiffView
      text={"diff --git a/a b/a\n@@ -1 +1 @@\n-old\n+new"}
      language="plaintext"
      wordWrap
    />,
  );
  expect(container.querySelector(".split-diff.wrap")).toBeTruthy();
  expect(container.textContent).toContain("old");
  expect(container.textContent).toContain("new");
});
