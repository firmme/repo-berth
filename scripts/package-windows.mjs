import assert from "node:assert/strict";
import { githubClientId, binaryDirectory } from "./app-config.mjs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

// All inputs come from this checkout, installed lockfile dependencies and the
// actual production Go package graph. No account data or bin/* wildcard is copied.
assert.equal(
  process.platform,
  "win32",
  "This archive script packages the Windows build only",
);
const root = resolve(import.meta.dirname, "..");
const run = (program, args, options = {}) =>
  execFileSync(program, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 32 << 20,
    ...options,
  });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const licenseName = /^(licen[cs]e|copying|notice|authors)([-_. ].*)?$/i;
const rootPkg = json(join(root, "frontend/package.json"));
const publisherClientId = githubClientId;
assert(
  publisherClientId,
  "Cannot package a login-ready release without REPO_BERTH_GITHUB_CLIENT_ID (publisher configuration)",
);
assert.match(rootPkg.version, /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/);
if (!process.argv.includes("--skip-build"))
  run(process.execPath, [join(root, "scripts/build.mjs")], {
    stdio: "inherit",
  });
const [goVersion, goRoot, goOS, goArch] = run("go", [
  "env",
  "GOVERSION",
  "GOROOT",
  "GOOS",
  "GOARCH",
])
  .trim()
  .split(/\r?\n/);
assert.equal(goOS, "windows", "Package the native Windows target");
const executable = join(binaryDirectory, "RepoBerth.exe");
assert(existsSync(executable), "Build the application first");
const buildInfo = run("go", ["version", "-m", executable]);
assert(
  readFileSync(executable).includes(Buffer.from(publisherClientId)),
  "Executable does not embed the configured application OAuth identity; rebuild before packaging",
);
assert(
  buildInfo.includes(goVersion),
  "Binary and current Go toolchain differ; rebuild without --skip-build",
);
assert(
  buildInfo.includes("GOOS=windows") && buildInfo.includes("GOARCH=" + goArch),
  "Binary target does not match package target",
);
const releaseRoot = join(root, "bin/releases");
mkdirSync(releaseRoot, { recursive: true });
const stageRoot = mkdtempSync(join(releaseRoot, ".stage-"));
const name = `RepoBerth-${rootPkg.version}-windows-${goArch}`;
const stage = join(stageRoot, name);
mkdirSync(stage);
const entries = [];
const within = (base, path) => path === base || path.startsWith(base + sep);
function legalFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && licenseName.test(e.name))
    .map((e) => join(dir, e.name))
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
function addDependency(
  ecosystem,
  name,
  version,
  files,
  sourceRoot,
  metadata = {},
) {
  assert(
    files.length,
    `Missing license files for ${ecosystem} ${name}@${version}; inspect before packaging`,
  );
  const id = ecosystem + "-" + hash(name + "@" + version).slice(0, 16);
  const directory = join(stage, "licenses", id);
  mkdirSync(directory, { recursive: true });
  const licenses = [...new Set(files)].sort().map((source, i) => {
    const filename = String(i + 1).padStart(2, "0") + "-" + basename(source);
    const bytes = readFileSync(source);
    copyFileSync(source, join(directory, filename));
    return {
      file: `licenses/${id}/${filename}`,
      source: relative(sourceRoot, source).replaceAll("\\", "/"),
      sha256: hash(bytes),
    };
  });
  entries.push({ ecosystem, name, version, ...metadata, licenses });
}
try {
  const format =
    "{{if .Module}}{{if not .Module.Main}}M|{{.Module.Path}}|{{.Module.Version}}|{{.Module.Dir}}|{{.Dir}}{{end}}{{else}}{{if .Standard}}S|{{.Dir}}{{end}}{{end}}";
  const modules = new Map(),
    standard = [];
  for (const line of run("go", [
    "list",
    "-deps",
    "-tags",
    "production",
    "-f",
    format,
    ".",
  ])
    .trim()
    .split(/\r?\n/)) {
    const [kind, name, version, dir, packageDir] = line.split("|");
    if (kind === "M") {
      const module = modules.get(name) || { name, version, dir, packages: [] };
      module.packages.push(packageDir);
      modules.set(name, module);
    }
    if (kind === "S") standard.push(name);
  }
  for (const module of modules.values()) {
    assert(
      buildInfo.includes(module.name + "\t" + module.version),
      "Binary dependency differs from source graph: " + module.name,
    );
    const files = [
      ...legalFiles(module.dir),
      ...module.packages.flatMap((p) => collectAncestors(p, module.dir)),
    ];
    addDependency("go", module.name, module.version, files, module.dir);
  }
  const stdFiles = [
    ...legalFiles(goRoot),
    ...standard.flatMap((dir) => collectAncestors(dir, join(goRoot, "src"))),
  ];
  addDependency(
    "go-toolchain",
    "Go standard library",
    goVersion,
    stdFiles,
    goRoot,
  );
  const lock = json(join(root, "frontend/package-lock.json"));
  const seen = new Set();
  function resolvePackage(name, from) {
    for (
      let current = from;
      within(join(root, "frontend"), current);
      current = dirname(current)
    ) {
      const candidate = join(current, "node_modules", name);
      if (existsSync(join(candidate, "package.json"))) return candidate;
      if (current === join(root, "frontend")) break;
    }
    throw new Error("Installed runtime dependency missing: " + name);
  }
  function visit(name, from) {
    const dir = resolvePackage(name, from);
    if (seen.has(dir)) return;
    seen.add(dir);
    const pkg = json(join(dir, "package.json"));
    const locked =
      lock.packages[
        relative(join(root, "frontend"), dir).replaceAll("\\", "/")
      ];
    assert(
      locked && locked.version === pkg.version,
      "Installed dependency does not match lockfile: " + name,
    );
    let files = legalFiles(dir),
      sourceRoot = dir,
      provenance;
    if (!files.length && name === "@wailsio/runtime") {
      const wails = modules.get("github.com/wailsapp/wails/v3");
      assert(
        wails?.version === "v" + pkg.version,
        "Wails runtime needs a matching module license",
      );
      files = [join(wails.dir, "LICENSE")];
      sourceRoot = wails.dir;
      provenance =
        "Matching-version github.com/wailsapp/wails/v3 LICENSE; npm package declares MIT but omits license text";
    }
    addDependency("npm", pkg.name, pkg.version, files, sourceRoot, {
      declaredLicense: pkg.license || null,
      ...(provenance ? { provenance } : {}),
    });
    for (const dependency of Object.keys(pkg.dependencies || {}))
      visit(dependency, dir);
    for (const dependency of Object.keys(pkg.optionalDependencies || {})) {
      let found;
      try {
        found = resolvePackage(dependency, dir);
      } catch {
        continue;
      }
      if (found) visit(dependency, dir);
    }
  }
  for (const name of Object.keys(rootPkg.dependencies))
    visit(name, join(root, "frontend"));
  entries.sort((a, b) =>
    (a.ecosystem + "/" + a.name).localeCompare(b.ecosystem + "/" + b.name),
  );
  copyFileSync(executable, join(stage, "RepoBerth.exe"));
  for (const file of ["README.md", "PRODUCT_AUDIT.md", "DEVELOPER_SETUP.md"])
    copyFileSync(join(root, file), join(stage, file));
  writeFileSync(
    join(stage, "THIRD_PARTY_NOTICES.txt"),
    [
      "Repo Berth third-party notices",
      "This inventory contains installed frontend runtime dependencies, the current Windows production Go package graph, and the Go standard library.",
      "License and notice texts are copied verbatim to licenses/. Nested notices are retained for used Go packages. Build-only tools and OS-provided WebView2/Git are not bundled.",
      "",
      ...entries.flatMap((e) => [
        `${e.ecosystem}: ${e.name} @ ${e.version}`,
        ...e.licenses.map((l) => "  " + l.file + " (source: " + l.source + ")"),
        ...(e.provenance ? ["  " + e.provenance] : []),
        "",
      ]),
    ].join("\n"),
  );
  writeFileSync(
    join(stage, "dependencies.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        target: { os: goOS, arch: goArch },
        dependencies: entries,
      },
      null,
      2,
    ) + "\n",
  );
  const artifact = {
    name: "Repo Berth",
    version: rootPkg.version,
    target: { os: goOS, arch: goArch },
    toolchain: goVersion,
    binary: {
      file: "RepoBerth.exe",
      bytes: statSync(executable).size,
      sha256: hash(readFileSync(executable)),
    },
    inputs: {
      goMod: hash(readFileSync(join(root, "go.mod"))),
      goSum: hash(readFileSync(join(root, "go.sum"))),
      frontendLock: hash(
        readFileSync(join(root, "frontend/package-lock.json")),
      ),
    },
  };
  writeFileSync(
    join(stage, "BUILD.json"),
    JSON.stringify(artifact, null, 2) + "\n",
  );
  const archive = join(releaseRoot, name + ".zip");
  run(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Compress-Archive -LiteralPath $env:BERTH_PACKAGE_SOURCE -DestinationPath $env:BERTH_PACKAGE_ARCHIVE -CompressionLevel Optimal -Force",
    ],
    {
      env: {
        ...process.env,
        BERTH_PACKAGE_SOURCE: stage,
        BERTH_PACKAGE_ARCHIVE: archive,
      },
    },
  );
  writeFileSync(
    archive + ".sha256",
    `${hash(readFileSync(archive))}  ${basename(archive)}\n`,
  );
  console.log(
    `Packaged: ${archive}\nDependencies: ${entries.length}; SHA-256 file written alongside archive`,
  );
} finally {
  // Only delete the newly-created stage after resolving and checking containment.
  const realStage = realpathSync(stageRoot),
    realReleases = realpathSync(releaseRoot);
  assert(
    within(realReleases, realStage) &&
      basename(realStage).startsWith(".stage-"),
    "Refusing to remove stage outside release directory",
  );
  rmSync(realStage, { recursive: true, force: true });
}
