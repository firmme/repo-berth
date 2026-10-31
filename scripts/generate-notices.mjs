import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { appVersion } from "./app-config.mjs";

const root = resolve(import.meta.dirname, "..");
const frontend = join(root, "frontend");
const run = (program, args) =>
  execFileSync(program, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 32 << 20,
  }).trim();
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const licenseName = /^(licen[cs]e|copying|notice|authors)([-_. ].*)?$/i;
const within = (base, path) => path === base || path.startsWith(base + sep);
const rootPkg = json(join(frontend, "package.json"));
const lock = json(join(frontend, "package-lock.json"));
const entries = [];

function legalFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && licenseName.test(entry.name))
    .map((entry) => join(dir, entry.name))
    .sort();
}

function collectAncestors(path, stop) {
  const found = [];
  for (let current = path; within(stop, current); current = dirname(current)) {
    found.push(...legalFiles(current));
    if (current === stop) break;
  }
  return found;
}

function addDependency(ecosystem, name, version, files, sourceRoot, metadata = {}) {
  if (!files.length)
    throw new Error(`Missing license files for ${ecosystem} ${name}@${version}`);
  const licenses = [...new Set(files)].sort().map((source) => ({
    file: basename(source),
    source: relative(sourceRoot, source).replaceAll("\\", "/"),
    sha256: createHash("sha256").update(readFileSync(source)).digest("hex"),
    text: readFileSync(source, "utf8"),
  }));
  entries.push({ ecosystem, name, version, ...metadata, licenses });
}

const [goVersion, goRoot] = run("go", ["env", "GOVERSION", "GOROOT"]).split(/\r?\n/);
const format =
  "{{if .Module}}{{if not .Module.Main}}M|{{.Module.Path}}|{{.Module.Version}}|{{.Module.Dir}}|{{.Dir}}{{end}}{{else}}{{if .Standard}}S|{{.Dir}}{{end}}{{end}}";
const modules = new Map();
const standard = [];
for (const line of run("go", ["list", "-deps", "-tags", "production", "-f", format, "."]).split(
  /\r?\n/,
)) {
  const [kind, name, version, dir, packageDir] = line.split("|");
  if (kind === "M") {
    const module = modules.get(name) || { name, version, dir, packages: [] };
    module.packages.push(packageDir);
    modules.set(name, module);
  }
  if (kind === "S") standard.push(name);
}
for (const module of modules.values()) {
  const files = [
    ...legalFiles(module.dir),
    ...module.packages.flatMap((dir) => collectAncestors(dir, module.dir)),
  ];
  addDependency("go", module.name, module.version, files, module.dir);
}
addDependency(
  "go-toolchain",
  "Go standard library",
  goVersion,
  [...legalFiles(goRoot), ...standard.flatMap((dir) => collectAncestors(dir, join(goRoot, "src")))],
  goRoot,
);

const seen = new Set();
function resolvePackage(name, from) {
  for (let current = from; within(frontend, current); current = dirname(current)) {
    const candidate = join(current, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (current === frontend) break;
  }
  throw new Error("Installed runtime dependency missing: " + name);
}
function repositoryOf(pkg) {
  if (typeof pkg.repository === "string") return pkg.repository;
  return pkg.repository?.url || "";
}
function visit(name, from) {
  const dir = resolvePackage(name, from);
  if (seen.has(dir)) return;
  seen.add(dir);
  const pkg = json(join(dir, "package.json"));
  const locked = lock.packages[relative(frontend, dir).replaceAll("\\", "/")];
  if (!locked || locked.version !== pkg.version)
    throw new Error("Installed dependency does not match lockfile: " + name);
  let files = legalFiles(dir);
  let sourceRoot = dir;
  let provenance;
  if (!files.length && name === "@wailsio/runtime") {
    const wails = modules.get("github.com/wailsapp/wails/v3");
    if (!wails || wails.version !== "v" + pkg.version)
      throw new Error("Wails runtime needs a matching module license");
    files = [join(wails.dir, "LICENSE")];
    sourceRoot = wails.dir;
    provenance =
      "Matching-version github.com/wailsapp/wails/v3 LICENSE; npm package declares MIT but omits license text";
  }
  addDependency("npm", pkg.name, pkg.version, files, sourceRoot, {
    declaredLicense: pkg.license || null,
    repository: repositoryOf(pkg),
    ...(provenance ? { provenance } : {}),
  });
  for (const dependency of Object.keys(pkg.dependencies || {})) visit(dependency, dir);
  for (const dependency of Object.keys(pkg.optionalDependencies || {})) {
    try {
      visit(dependency, dir);
    } catch {
      // Optional dependencies that are not installed are not part of this build.
    }
  }
}
for (const name of Object.keys(rootPkg.dependencies)) visit(name, frontend);
entries.sort((a, b) => (a.ecosystem + "/" + a.name).localeCompare(b.ecosystem + "/" + b.name));

const inventory = {
  schemaVersion: 1,
  version: appVersion,
  generatedAt: new Date().toISOString(),
  links: {
    repository: "https://github.com/firmme/repo-berth",
    releases: "https://github.com/firmme/repo-berth/releases",
    issues: "https://github.com/firmme/repo-berth/issues",
  },
  dependencies: entries,
};
const output = join(root, "internal/notices/notices.json.gz");
mkdirSync(dirname(output), { recursive: true });
if (existsSync(output)) {
  try {
    const previous = JSON.parse(gunzipSync(readFileSync(output)).toString("utf8"));
    if (
      previous.version === inventory.version &&
      JSON.stringify(previous.dependencies) === JSON.stringify(inventory.dependencies) &&
      JSON.stringify(previous.links) === JSON.stringify(inventory.links)
    ) {
      inventory.generatedAt = previous.generatedAt;
    }
  } catch {
    // Regenerate a corrupted or obsolete inventory.
  }
}
const raw = Buffer.from(JSON.stringify(inventory, null, 2));
writeFileSync(output, gzipSync(raw, { level: 9 }));
console.log(
  `Embedded notices: ${entries.length} dependencies, ${(raw.length / 1024).toFixed(0)} KiB -> ${(
    readFileSync(output).length / 1024
  ).toFixed(0)} KiB`,
);
