import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { resolve, join, dirname, delimiter } from "node:path";
import { githubClientId, appVersion, binaryDirectory } from "./app-config.mjs";

const root = resolve(import.meta.dirname, "..");
const clientId = githubClientId;
const development =
  !clientId && process.argv.includes("--allow-unconfigured-auth");
if (!clientId && !development)
  throw new Error(
    "Publisher configuration missing: set REPO_BERTH_GITHUB_CLIENT_ID to the application OAuth Client ID. End users must not configure this. For local-only development use --allow-unconfigured-auth.",
  );
if (clientId && !/^[A-Za-z0-9_-]{8,128}$/.test(clientId))
  throw new Error("Invalid publisher OAuth Client ID");
const suffix = development ? "-dev" : "";
// cmd.exe is used only for this fixed npm command, with no interpolated data.
if (process.platform === "win32")
  execFileSync("cmd.exe", ["/d", "/s", "/c", "npm run build"], {
    cwd: join(root, "frontend"),
    stdio: "inherit",
  });
else
  execFileSync("npm", ["run", "build"], {
    cwd: join(root, "frontend"),
    stdio: "inherit",
  });
let output = join(
  root,
  "bin",
  appVersion,
  process.platform === "win32"
    ? `RepoBerth${suffix}.exe`
    : `repo-berth${suffix}`,
);
if (process.platform === "darwin") {
  const contents = join(binaryDirectory, `Repo Berth${suffix}.app`, "Contents");
  mkdirSync(join(contents, "MacOS"), { recursive: true });
  output = join(contents, "MacOS", "repo-berth");
  mkdirSync(join(contents, "Resources"), { recursive: true });
  copyFileSync(
    join(root, "assets/app.icns"),
    join(contents, "Resources/app.icns"),
  );
  writeFileSync(
    join(contents, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleName</key><string>Repo Berth</string><key>CFBundleDisplayName</key><string>Repo Berth</string><key>CFBundleIdentifier</key><string>dev.repoberth.desktop</string><key>CFBundleVersion</key><string>${appVersion}</string><key>CFBundleShortVersionString</key><string>${appVersion}</string><key>CFBundleIconFile</key><string>app.icns</string><key>CFBundleExecutable</key><string>repo-berth</string><key>CFBundlePackageType</key><string>APPL</string><key>LSMinimumSystemVersion</key><string>12.0</string><key>NSHighResolutionCapable</key><true/></dict></plist>`,
  );
}
mkdirSync(binaryDirectory, { recursive: true });
if (process.platform === "win32") {
  const architecture = execFileSync("go", ["env", "GOARCH"], {
    encoding: "utf8",
    cwd: root,
  }).trim();
  if (architecture !== "amd64")
    throw new Error(
      "Windows icon resource generation currently requires amd64",
    );
  const windres =
    process.env.WINDRES ||
    (existsSync("C:/msys64/mingw64/bin/windres.exe")
      ? "C:/msys64/mingw64/bin/windres.exe"
      : "windres");
  execFileSync(
    windres,
    [
      "--target",
      "pe-x86-64",
      "-i",
      "app.rc",
      "-o",
      join(root, "resources_windows_amd64.syso"),
    ],
    {
      cwd: join(root, "assets"),
      stdio: "inherit",
      windowsHide: true,
      env: {
        ...process.env,
        PATH: dirname(windres) + delimiter + process.env.PATH,
      },
    },
  );
}
const flags =
  (process.platform === "win32" ? "-s -w -H=windowsgui" : "-s -w") +
  ` -X main.appVersion=${appVersion}` +
  (clientId
    ? ` -X repo-berth/internal/service.GitHubOAuthClientID=${clientId}`
    : "");
const args = [
  "build",
  "-trimpath",
  "-tags",
  "production",
  "-ldflags",
  flags,
  "-o",
  output,
  ".",
];
execFileSync("go", args, { cwd: root, stdio: "inherit" });
console.log(`Built: ${output}`);
if (development)
  console.log(
    "Development-only build: GitHub publisher configuration is absent; do not distribute as a login-ready release.",
  );
