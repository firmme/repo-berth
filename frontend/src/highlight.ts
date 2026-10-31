export type LanguageId =
  | "plaintext"
  | "javascript"
  | "typescript"
  | "jsx"
  | "tsx"
  | "json"
  | "html"
  | "xml"
  | "css"
  | "markdown"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "c"
  | "cpp"
  | "csharp"
  | "shell"
  | "yaml"
  | "toml"
  | "ini"
  | "sql"
  | "php"
  | "ruby"
  | "diff";

export const LANGUAGES: { id: LanguageId; label: string }[] = [
  { id: "plaintext", label: "纯文本" },
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "jsx", label: "JavaScript JSX" },
  { id: "tsx", label: "TypeScript JSX" },
  { id: "json", label: "JSON" },
  { id: "html", label: "HTML" },
  { id: "xml", label: "XML" },
  { id: "css", label: "CSS" },
  { id: "markdown", label: "Markdown" },
  { id: "python", label: "Python" },
  { id: "go", label: "Go" },
  { id: "rust", label: "Rust" },
  { id: "java", label: "Java" },
  { id: "c", label: "C" },
  { id: "cpp", label: "C++" },
  { id: "csharp", label: "C#" },
  { id: "shell", label: "Shell" },
  { id: "yaml", label: "YAML" },
  { id: "toml", label: "TOML" },
  { id: "ini", label: "INI" },
  { id: "sql", label: "SQL" },
  { id: "php", label: "PHP" },
  { id: "ruby", label: "Ruby" },
  { id: "diff", label: "Diff" },
];

const labels = new Map(LANGUAGES.map((item) => [item.id, item.label]));
const byExtension: Record<string, LanguageId> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  json: "json",
  jsonc: "json",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  css: "css",
  scss: "css",
  less: "css",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  py: "python",
  pyw: "python",
  go: "go",
  rs: "rust",
  java: "java",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  cs: "csharp",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  ps1: "shell",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  sql: "sql",
  php: "php",
  rb: "ruby",
  diff: "diff",
  patch: "diff",
};

export function detectLanguage(path: string): LanguageId {
  const name = path.split("/").at(-1)?.toLowerCase() || "";
  if (name === "dockerfile") return "shell";
  if (name === "makefile" || name === "cmakelists.txt") return "plaintext";
  const extension = name.includes(".") ? name.split(".").at(-1) || "" : "";
  return byExtension[extension] || "plaintext";
}

export function languageLabel(language: LanguageId) {
  return labels.get(language) || "纯文本";
}

function escapeHTML(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function span(type: string, value: string) {
  return `<span class="tok-${type}">${escapeHTML(value)}</span>`;
}

type Grammar = {
  line?: string[];
  block?: [string, string][];
  quotes?: string[];
  keywords?: string[];
  propertyBefore?: string[];
};

const common = {
  quotes: ['"', "'", "`"],
};

const jsKeywords = [
  "as", "async", "await", "break", "case", "catch", "class", "const",
  "continue", "debugger", "default", "delete", "do", "else", "export",
  "extends", "finally", "for", "from", "function", "get", "if", "implements",
  "import", "in", "instanceof", "interface", "let", "new", "of", "package",
  "private", "protected", "public", "readonly", "return", "set", "static",
  "super", "switch", "throw", "try", "type", "typeof", "undefined", "var",
  "void", "while", "with", "yield", "enum", "declare", "abstract", "satisfies",
  "keyof", "infer", "is", "namespace", "module",
];

const grammars: Partial<Record<LanguageId, Grammar>> = {
  javascript: { line: ["//"], block: [["/*", "*/"]], ...common, keywords: jsKeywords },
  typescript: { line: ["//"], block: [["/*", "*/"]], ...common, keywords: jsKeywords },
  jsx: { line: ["//"], block: [["/*", "*/"]], ...common, keywords: jsKeywords },
  tsx: { line: ["//"], block: [["/*", "*/"]], ...common, keywords: jsKeywords },
  json: { ...common, keywords: ["true", "false", "null"], propertyBefore: [":"] },
  css: { block: [["/*", "*/"]], ...common, keywords: ["important", "media", "supports", "keyframes", "import", "charset", "font-face"], propertyBefore: [":"] },
  python: { line: ["#"], ...common, keywords: ["and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else", "except", "False", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "None", "nonlocal", "not", "or", "pass", "raise", "return", "True", "try", "while", "with", "yield", "match", "case"] },
  go: { line: ["//"], block: [["/*", "*/"]], ...common, keywords: ["break", "case", "chan", "const", "continue", "default", "defer", "else", "fallthrough", "for", "func", "go", "goto", "if", "import", "interface", "map", "package", "range", "return", "select", "struct", "switch", "type", "var", "nil", "true", "false", "iota"] },
  rust: { line: ["//"], block: [["/*", "*/"]], ...common, keywords: ["as", "async", "await", "break", "const", "continue", "crate", "dyn", "else", "enum", "extern", "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub", "ref", "return", "self", "Self", "static", "struct", "super", "trait", "true", "type", "unsafe", "use", "where", "while", "Some", "None", "Ok", "Err"] },
  java: { line: ["//"], block: [["/*", "*/"]], ...common, keywords: ["abstract", "assert", "boolean", "break", "byte", "case", "catch", "char", "class", "const", "continue", "default", "do", "double", "else", "enum", "extends", "final", "finally", "float", "for", "if", "implements", "import", "instanceof", "int", "interface", "long", "native", "new", "package", "private", "protected", "public", "return", "short", "static", "strictfp", "super", "switch", "synchronized", "this", "throw", "throws", "transient", "try", "void", "volatile", "while", "true", "false", "null", "record", "sealed", "permits", "var"] },
  c: { line: ["//"], block: [["/*", "*/"]], ...common, keywords: ["auto", "break", "case", "char", "const", "continue", "default", "do", "double", "else", "enum", "extern", "float", "for", "goto", "if", "inline", "int", "long", "register", "restrict", "return", "short", "signed", "sizeof", "static", "struct", "switch", "typedef", "union", "unsigned", "void", "volatile", "while", "NULL", "true", "false"] },
  cpp: { line: ["//"], block: [["/*", "*/"]], ...common, keywords: ["alignas", "alignof", "auto", "bool", "break", "case", "catch", "char", "class", "const", "constexpr", "continue", "decltype", "default", "delete", "do", "double", "else", "enum", "explicit", "extern", "false", "float", "for", "friend", "if", "inline", "int", "long", "mutable", "namespace", "new", "noexcept", "nullptr", "operator", "private", "protected", "public", "return", "short", "signed", "sizeof", "static", "struct", "switch", "template", "this", "throw", "true", "try", "typedef", "typename", "union", "unsigned", "using", "virtual", "void", "volatile", "while"] },
  csharp: { line: ["//"], block: [["/*", "*/"]], ...common, keywords: ["abstract", "as", "async", "await", "base", "bool", "break", "byte", "case", "catch", "char", "checked", "class", "const", "continue", "decimal", "default", "delegate", "do", "double", "else", "enum", "event", "explicit", "extern", "false", "finally", "fixed", "float", "for", "foreach", "if", "implicit", "in", "int", "interface", "internal", "is", "lock", "long", "namespace", "new", "null", "object", "operator", "out", "override", "params", "private", "protected", "public", "readonly", "record", "ref", "return", "sbyte", "sealed", "short", "sizeof", "static", "string", "struct", "switch", "this", "throw", "true", "try", "typeof", "uint", "ulong", "unchecked", "unsafe", "ushort", "using", "var", "virtual", "void", "volatile", "while", "yield"] },
  shell: { line: ["#"], ...common, keywords: ["if", "then", "else", "elif", "fi", "for", "while", "do", "done", "case", "esac", "function", "in", "select", "until", "time", "coproc", "return", "exit", "export", "local", "readonly", "declare", "unset", "shift", "source", "alias", "echo", "cd", "set", "trap"] },
  yaml: { line: ["#"], ...common, keywords: ["true", "false", "null", "yes", "no", "on", "off"], propertyBefore: [":"] },
  toml: { line: ["#"], ...common, keywords: ["true", "false"], propertyBefore: ["="] },
  ini: { line: ["#", ";"], ...common, propertyBefore: ["="] },
  sql: { line: ["--"], block: [["/*", "*/"]], ...common, keywords: ["add", "all", "alter", "and", "any", "as", "asc", "begin", "between", "by", "case", "check", "column", "commit", "constraint", "create", "database", "default", "delete", "desc", "distinct", "drop", "else", "end", "exists", "foreign", "from", "full", "group", "having", "in", "index", "inner", "insert", "into", "is", "join", "key", "left", "like", "limit", "not", "null", "offset", "on", "or", "order", "outer", "primary", "references", "right", "rollback", "select", "set", "table", "then", "union", "unique", "update", "values", "view", "when", "where"] },
  php: { line: ["//", "#"], block: [["/*", "*/"]], ...common, keywords: ["abstract", "and", "array", "as", "break", "callable", "case", "catch", "class", "clone", "const", "continue", "declare", "default", "do", "echo", "else", "elseif", "empty", "enddeclare", "endfor", "endforeach", "endif", "endswitch", "endwhile", "eval", "exit", "extends", "final", "finally", "fn", "for", "foreach", "function", "global", "goto", "if", "implements", "include", "instanceof", "insteadof", "interface", "isset", "list", "match", "namespace", "new", "or", "print", "private", "protected", "public", "readonly", "require", "return", "static", "switch", "throw", "trait", "try", "unset", "use", "var", "while", "xor", "yield", "true", "false", "null"] },
  ruby: { line: ["#"], ...common, keywords: ["alias", "and", "begin", "break", "case", "class", "def", "defined?", "do", "else", "elsif", "end", "ensure", "false", "for", "if", "in", "module", "next", "nil", "not", "or", "redo", "rescue", "retry", "return", "self", "super", "then", "true", "undef", "unless", "until", "when", "while", "yield"] },
};

function nextNonSpace(code: string, index: number) {
  let cursor = index;
  while (cursor < code.length && /\s/.test(code[cursor])) cursor++;
  return code[cursor] || "";
}

function genericHighlight(code: string, language: LanguageId, grammar: Grammar) {
  const keywords = new Set(grammar.keywords || []);
  let html = "";
  let plain = "";
  let index = 0;
  const flush = () => {
    if (plain) {
      html += escapeHTML(plain);
      plain = "";
    }
  };
  const lineComments = grammar.line || [];
  const blockComments = grammar.block || [];
  const quotes = grammar.quotes || [];

  while (index < code.length) {
    const block = blockComments.find(([start]) => code.startsWith(start, index));
    if (block) {
      flush();
      const end = code.indexOf(block[1], index + block[0].length);
      const next = end < 0 ? code.length : end + block[1].length;
      html += span("comment", code.slice(index, next));
      index = next;
      continue;
    }
    const line = lineComments.find((start) => code.startsWith(start, index));
    if (line) {
      flush();
      let next = code.indexOf("\n", index);
      if (next < 0) next = code.length;
      html += span("comment", code.slice(index, next));
      index = next;
      continue;
    }
    const quote = quotes.find((start) => code.startsWith(start, index));
    if (quote) {
      flush();
      let next = index + quote.length;
      while (next < code.length) {
        if (code[next] === "\\") {
          next += 2;
          continue;
        }
        if (code.startsWith(quote, next)) {
          next += quote.length;
          break;
        }
        next++;
      }
      const value = code.slice(index, next);
      const property =
        grammar.propertyBefore?.includes(nextNonSpace(code, next)) &&
        !value.includes("\n");
      html += span(property ? "property" : "string", value);
      index = next;
      continue;
    }
    if (/[0-9]/.test(code[index]) && (index === 0 || !/[\w$]/.test(code[index - 1]))) {
      flush();
      let next = index + 1;
      while (next < code.length && /[0-9a-fA-FxXoObB._]/.test(code[next])) next++;
      html += span("number", code.slice(index, next));
      index = next;
      continue;
    }
    if (/[A-Za-z_$]/.test(code[index])) {
      flush();
      let next = index + 1;
      while (next < code.length && /[\w$]/.test(code[next])) next++;
      const word = code.slice(index, next);
      if (keywords.has(word)) {
        html += span("keyword", word);
      } else if (
        language === "json" &&
        nextNonSpace(code, next) === ":" &&
        code.slice(index, next).startsWith('"')
      ) {
        html += span("property", word);
      } else {
        html += escapeHTML(word);
      }
      index = next;
      continue;
    }
    plain += code[index];
    index++;
  }
  flush();
  return html;
}

function highlightHTML(code: string) {
  let html = "";
  let index = 0;
  while (index < code.length) {
    if (code.startsWith("<!--", index)) {
      const end = code.indexOf("-->", index + 4);
      const next = end < 0 ? code.length : end + 3;
      html += span("comment", code.slice(index, next));
      index = next;
      continue;
    }
    if (code[index] !== "<") {
      let next = code.indexOf("<", index);
      if (next < 0) next = code.length;
      html += escapeHTML(code.slice(index, next));
      index = next;
      continue;
    }
    const close = code.indexOf(">", index);
    if (close < 0) {
      html += escapeHTML(code.slice(index));
      break;
    }
    const content = code.slice(index + 1, close);
    if (/^\s*[!/]/.test(content)) {
      html += `<span class="tok-meta">&lt;${escapeHTML(content)}&gt;</span>`;
      index = close + 1;
      continue;
    }
    const match = /^\/?\s*([A-Za-z0-9:-]+)/.exec(content);
    if (!match) {
      html += escapeHTML(code.slice(index, close + 1));
      index = close + 1;
      continue;
    }
    const prefix = content.slice(0, match.index + match[0].indexOf(match[1]));
    const rest = content.slice(prefix.length + match[1].length);
    html += `&lt;${escapeHTML(prefix)}${span("tag", match[1])}`;
    let cursor = 0;
    while (cursor < rest.length) {
      const char = rest[cursor];
      if (/[\s/]/.test(char)) {
        html += escapeHTML(char);
        cursor++;
        continue;
      }
      const attr = /^[A-Za-z_:][\w:.-]*/.exec(rest.slice(cursor));
      if (attr) {
        html += span("attr", attr[0]);
        cursor += attr[0].length;
        continue;
      }
      const quote = rest[cursor] === '"' || rest[cursor] === "'" ? rest[cursor] : "";
      if (quote) {
        let next = cursor + 1;
        while (next < rest.length && rest[next] !== quote) next++;
        next = Math.min(rest.length, next + 1);
        html += span("string", rest.slice(cursor, next));
        cursor = next;
        continue;
      }
      html += escapeHTML(char);
      cursor++;
    }
    html += "&gt;";
    index = close + 1;
  }
  return html;
}

function highlightMarkdown(code: string) {
  return code.split("\n").map((line) => {
    if (/^```/.test(line)) return span("meta", line);
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) return `${span("keyword", heading[1])} ${span("heading", heading[2])}`;
    const quote = /^>\s?/.exec(line);
    if (quote) return `${span("meta", quote[0])}${escapeHTML(line.slice(quote[0].length))}`;
    return escapeHTML(line)
      .replace(/`([^`]+)`/g, '<span class="tok-string">`$1`</span>')
      .replace(/\*\*([^*]+)\*\*/g, '<span class="tok-keyword">**$1**</span>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span class="tok-property">[$1]</span><span class="tok-string">($2)</span>');
  }).join("\n");
}

function highlightDiff(code: string) {
  return code.split("\n").map((line) => {
    if (/^(diff --git|index |--- |\+\+\+ )/.test(line)) return span("meta", line);
    if (/^@@/.test(line)) return span("keyword", line);
    if (line.startsWith("+")) return span("add", line);
    if (line.startsWith("-")) return span("del", line);
    return escapeHTML(line);
  }).join("\n");
}

export function highlightCode(code: string, language: LanguageId) {
  if (code.length > 400000) return escapeHTML(code);
  if (language === "plaintext") return escapeHTML(code);
  if (language === "html" || language === "xml") return highlightHTML(code);
  if (language === "markdown") return highlightMarkdown(code);
  if (language === "diff") return highlightDiff(code);
  const grammar = grammars[language];
  if (!grammar) return escapeHTML(code);
  return genericHighlight(code, language, grammar);
}

