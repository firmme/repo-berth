import { describe, expect, it } from "vitest";
import { detectLanguage, highlightCode, languageLabel } from "./highlight";

describe("code highlighting", () => {
  it("detects languages from file extensions", () => {
    expect(detectLanguage("src/app.tsx")).toBe("tsx");
    expect(detectLanguage("main.go")).toBe("go");
    expect(detectLanguage("README.md")).toBe("markdown");
    expect(detectLanguage("Dockerfile")).toBe("shell");
    expect(detectLanguage("file.unknown")).toBe("plaintext");
    expect(languageLabel("typescript")).toBe("TypeScript");
  });

  it("highlights tokens and escapes markup", () => {
    const html = highlightCode('const value = "<script>";', "typescript");
    expect(html).toContain('class="tok-keyword">const');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("highlights diff lines", () => {
    const html = highlightCode("+added\n-removed\n@@ -1 +1 @@", "diff");
    expect(html).toContain('class="tok-add">+added');
    expect(html).toContain('class="tok-del">-removed');
    expect(html).toContain('class="tok-keyword">@@ -1 +1 @@');
  });
});
