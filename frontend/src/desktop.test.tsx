// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DiffViewer } from "./desktop";

afterEach(cleanup);

const patch = `diff --git a/code.ts b/code.ts
index 1234567..abcdef0 100644
--- a/code.ts
+++ b/code.ts
@@ -20,2 +20,3 @@
 unchanged
-oldValue
+newValue
+addedValue
diff --git a/other.ts b/other.ts
index 1234567..abcdef0 100644
--- a/other.ts
+++ b/other.ts
@@ -3 +3 @@
-oldOther
+newOther
`;

it("numbers real patch lines and resets line counters for each file", () => {
  render(<DiffViewer text={patch} />);
  const row = (text: string) => screen.getByText(text).closest(".diff-line")!;
  expect(row("unchanged").textContent).toBe("2020 unchanged");
  expect(row("-oldValue").textContent).toBe("21-oldValue");
  expect(row("+newValue").textContent).toBe("21+newValue");
  expect(row("+addedValue").textContent).toBe("22+addedValue");
  expect(row("-oldOther").textContent).toBe("3-oldOther");
  expect(row("+newOther").textContent).toBe("3+newOther");
  expect(document.querySelectorAll(".diff-line.file")).toHaveLength(2);
  expect(screen.queryByText("--- a/code.ts")).toBeNull();
  expect(screen.queryByText("+++ b/code.ts")).toBeNull();
  const summary = document.querySelector(".diff-summary")!;
  expect(summary.textContent).toContain("2 个文件");
  expect(summary.textContent).toContain("+3");
  expect(summary.textContent).toContain("−2");
});

it("omits redundant file headers in a selected-file diff", () => {
  render(<DiffViewer text={patch} showFileHeaders={false} />);
  expect(document.querySelectorAll(".diff-line.file")).toHaveLength(0);
  expect(screen.getByText("+newValue")).toBeTruthy();
});
