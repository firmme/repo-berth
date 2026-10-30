import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { appVersion, binaryDirectory } from "./app-config.mjs";

// Self-update artifacts must contain exactly one top-level entry for the
// updater to swap into place. They are separate from the full distribution
// archives, which also carry documentation and license files.
const root = resolve(import.meta.dirname, "..");
const arch = execFileSync("go", ["env", "GOARCH"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const releases = join(root, "bin", "releases");
mkdirSync(releases, { recursive: true });

let source;
let name;
if (process.platform === "darwin") {
  source = join(binaryDirectory, "Repo Berth.app");
  name = `RepoBerth-${appVersion}-macos-${arch}-update.zip`;
} else if (process.platform === "win32") {
  source = join(binaryDirectory, "RepoBerth.exe");
  name = `RepoBerth-${appVersion}-windows-${arch}-update.zip`;
} else if (process.platform === "linux") {
  source = join(binaryDirectory, "repo-berth");
  name = `RepoBerth-${appVersion}-linux-${arch}-update.tar.gz`;
} else {
  throw new Error(`Unsupported update platform: ${process.platform}`);
}
assert(existsSync(source), `Build the application first: ${source}`);
const destination = join(releases, name);

if (process.platform === "darwin") {
  execFileSync(
    "ditto",
    ["-c", "-k", "--norsrc", "--keepParent", source, destination],
    { stdio: "inherit" },
  );
} else if (process.platform === "win32") {
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Compress-Archive -LiteralPath $env:BERTH_UPDATE_SOURCE -DestinationPath $env:BERTH_UPDATE_TARGET -Force",
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        BERTH_UPDATE_SOURCE: source,
        BERTH_UPDATE_TARGET: destination,
      },
    },
  );
} else {
  execFileSync(
    "tar",
    ["-czf", destination, "-C", binaryDirectory, "repo-berth"],
    { stdio: "inherit" },
  );
}

const digest = createHash("sha256").update(readFileSync(destination)).digest("hex");
writeFileSync(`${destination}.sha256`, `${digest}  ${name}\n`);
console.log(`Update asset: ${destination}`);
