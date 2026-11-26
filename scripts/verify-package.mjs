import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, join, resolve, sep } from "node:path";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";

assert.equal(
  process.platform,
  "win32",
  "This verifier currently targets the Windows archive",
);
const root = resolve(import.meta.dirname, "..");
const run = (program, args, options = {}) =>
  execFileSync(program, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 8 << 20,
    ...options,
  });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const version = JSON.parse(
  readFileSync(join(root, "frontend/package.json"), "utf8"),
).version;
const arch = run("go", ["env", "GOARCH"]).trim();
const update = process.argv.includes("--update");
const releaseName = "RepoBerth-" + version + "-windows-" + arch + (update ? "-update" : "") + ".zip";
const archiveArgument = process.argv
  .slice(2)
  .find((arg) => !arg.startsWith("--"));
const archive = archiveArgument
  ? resolve(archiveArgument)
  : join(root, "bin/releases", releaseName);
if (update) assert.equal(basename(archive), releaseName);
const [expected, checksumName] = readFileSync(archive + ".sha256", "utf8")
  .trim()
  .split(/\s+/);
if (update) assert.equal(checksumName, releaseName);
assert.match(expected, /^[a-f0-9]{64}$/);
assert.equal(
  hash(readFileSync(archive)),
  expected,
  "Archive checksum mismatch",
);
const environment = { ...process.env, BERTH_VERIFY_ARCHIVE: archive };
const names = JSON.parse(
  run(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Add-Type -AssemblyName System.IO.Compression.FileSystem; $archive=[System.IO.Compression.ZipFile]::OpenRead($env:BERTH_VERIFY_ARCHIVE); try { ConvertTo-Json -Compress -InputObject @($archive.Entries | ForEach-Object { $_.FullName }) } finally { $archive.Dispose() }",
    ],
    { env: environment },
  ),
);
assert(Array.isArray(names));
const prefix = basename(archive, ".zip") + "/";
const normalized = names.map((n) => n.replaceAll("\\", "/"));
if (update) {
  assert.deepEqual(normalized, ["RepoBerth.exe"], "Update ZIP must contain exactly one top-level executable");
} else {
  assert.equal(
    new Set(normalized).size,
    normalized.length,
    "Duplicate archive entries",
  );
  for (const name of normalized) {
    assert(
      name.startsWith(prefix) && !name.split("/").includes(".."),
      "Unexpected archive path: " + name,
    );
    const item = name.slice(prefix.length);
    assert(
      item === "" ||
        item === "licenses/" ||
        /^licenses\/[a-z0-9-]+\/(?:[a-z0-9_. -]+)?$/i.test(item) ||
        [
          "RepoBerth.exe",
          "README.md",
          "PRODUCT_AUDIT.md",
          "DEVELOPER_SETUP.md",
          "BUILD.json",
          "dependencies.json",
          "THIRD_PARTY_NOTICES.txt",
        ].includes(item),
      "Unexpected artifact: " + item,
    );
  }
}
const releases = join(root, "bin/releases");
mkdirSync(releases, { recursive: true });
const scratch = mkdtempSync(join(releases, ".verify-"));
try {
  run(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:BERTH_VERIFY_ARCHIVE, $env:BERTH_VERIFY_DESTINATION)",
    ],
    { env: { ...environment, BERTH_VERIFY_DESTINATION: scratch } },
  );
  if (update) {
    const binary = join(scratch, "RepoBerth.exe");
    const payload = readFileSync(binary);
    assert.equal(payload.toString("ascii", 0, 2), "MZ");
    const pe = payload.readUInt32LE(0x3c);
    assert.equal(payload.toString("ascii", pe, pe + 4), "PE\0\0");
    const machine = { amd64: 0x8664, arm64: 0xaa64, "386": 0x14c }[arch];
    assert(machine && payload.readUInt16LE(pe + 4) === machine, "Windows executable architecture mismatch");
    assert.equal(run(binary, ["--version"]).trim(), version, "Executable version mismatch");
    console.log("PASS: Windows update archive contents, SHA-256, architecture and version");
  } else {
    verifyFullArchive(scratch);
  }
} finally {
  const actual = realpathSync(scratch),
    parent = realpathSync(releases);
  assert(
    actual.startsWith(parent + sep) && basename(actual).startsWith(".verify-"),
    "Refusing to remove verification directory outside release root",
  );
  rmSync(actual, { recursive: true, force: true });
}

function verifyFullArchive(scratch) {
  const unpacked = join(scratch, basename(archive, ".zip"));
  const build = JSON.parse(readFileSync(join(unpacked, "BUILD.json"), "utf8"));
  const binary = join(unpacked, "RepoBerth.exe");
  assert.equal(
    hash(readFileSync(binary)),
    build.binary.sha256,
    "Unpacked executable hash mismatch",
  );
  assert.equal(statSync(binary).size, build.binary.bytes);
  const inventory = JSON.parse(
    readFileSync(join(unpacked, "dependencies.json"), "utf8"),
  );
  const accounted = new Set();
  for (const dependency of inventory.dependencies) {
    assert(
      dependency.licenses.length,
      "Missing dependency license: " + dependency.name,
    );
    for (const license of dependency.licenses) {
      assert(
        license.file.startsWith("licenses/") &&
          !license.file.split("/").includes(".."),
      );
      assert.equal(
        hash(readFileSync(join(unpacked, license.file))),
        license.sha256,
        "License hash mismatch: " + dependency.name,
      );
      accounted.add(prefix + license.file);
    }
  }
  for (const name of normalized)
    if (name.startsWith(prefix + "licenses/") && !name.endsWith("/"))
      assert(accounted.has(name), "Unindexed license file: " + name);
  for (const file of [
    "README.md",
    "PRODUCT_AUDIT.md",
    "THIRD_PARTY_NOTICES.txt",
  ])
    assert(existsSync(join(unpacked, file)));
  assert(
    inventory.dependencies.some((d) => d.name === "@fontsource/ibm-plex-sans"),
    "Font license missing",
  );
  assert(
    inventory.dependencies.some(
      (d) =>
        d.name === "github.com/wailsapp/wails/v3" &&
        d.licenses.some((l) => l.source.includes("webviewloader")),
    ),
    "Used nested Wails license missing",
  );
  const native = !process.argv.includes("--no-native");
  if (native) {
    run(process.execPath, [join(root, "scripts/smoke-startup.mjs"), binary], {
      stdio: "inherit",
    });
    run(process.execPath, [join(root, "scripts/smoke-workspace.mjs"), binary], {
      stdio: "inherit",
    });
  }
  console.log(
    `PASS: archive checksum, allowlisted contents, ${inventory.dependencies.length} dependency inventories, every license hash; ${native ? "unpacked executable startup and local Git workflow verified" : "native UI checks explicitly skipped"}`,
  );
}
