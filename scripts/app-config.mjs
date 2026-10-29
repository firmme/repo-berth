import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const config = JSON.parse(
  readFileSync(resolve(root, "app.config.json"), "utf8"),
);
// A public application identifier, never a user token or Client Secret.
export const githubClientId =
  process.env.REPO_BERTH_GITHUB_CLIENT_ID?.trim() ||
  config.githubOAuthClientId?.trim() ||
  "";
export const appVersion = JSON.parse(
  readFileSync(resolve(root, "frontend/package.json"), "utf8"),
).version;
export const binaryDirectory = resolve(root, "bin", appVersion);
