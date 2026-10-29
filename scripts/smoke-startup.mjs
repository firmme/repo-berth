import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";

assert.equal(
  process.platform,
  "win32",
  "This native startup smoke currently targets Windows",
);
const data = resolve("bin/startup-smoke", String(Date.now()));
const dbPath = join(data, "RepoBerth", "berth.db");
await mkdir(join(data, "RepoBerth"), { recursive: true });
const original = Buffer.from(
  "intentional invalid SQLite fixture; preserve these bytes",
);
await writeFile(dbPath, original);
const executable = process.argv[2]
  ? resolve(process.argv[2])
  : resolve("bin/RepoBerth.exe");
const child = spawn(executable, ["--devtools-port=9238"], {
  env: { ...process.env, APPDATA: data },
  windowsHide: true,
  stdio: "ignore",
});
let ws;
try {
  let target;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const targets = await (
        await fetch("http://127.0.0.1:9238/json/list")
      ).json();
      target = targets.find((t) => t.title?.includes("启动恢复"));
      if (target) break;
    } catch {}
    if (child.exitCode !== null)
      throw new Error(
        `Application exited without recovery window: ${child.exitCode}`,
      );
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(target, "No startup recovery WebView appeared");
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const p = pending.get(message.id);
    if (p) {
      pending.delete(message.id);
      clearTimeout(p.timer);
      message.error
        ? p.reject(new Error(message.error.message))
        : p.resolve(message.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const current = ++id;
      const timer = setTimeout(
        () => reject(new Error(`CDP timeout: ${method}`)),
        10000,
      );
      pending.set(current, { resolve, reject, timer });
      ws.send(JSON.stringify({ id: current, method, params }));
    });
  let text = "";
  for (let i = 0; i < 50; i++) {
    const state = await send("Runtime.evaluate", {
      expression: 'document.body?.innerText||""',
      returnByValue: true,
    });
    text = state.result?.value || "";
    if (text.includes("STORAGE_OPEN")) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(text.includes("本地数据暂时无法打开"));
  assert(text.includes(dbPath));
  assert(text.includes("STORAGE_OPEN"));
  assert.deepEqual(
    await readFile(dbPath),
    original,
    "Startup recovery changed the invalid database",
  );
  const picture = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    resolve("bin/startup-recovery.png"),
    Buffer.from(picture.data, "base64"),
  );
  console.log(
    "PASS: corrupt database opens a native recovery window and preserves original file bytes",
  );
} finally {
  if (ws && ws.readyState < WebSocket.CLOSING)
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1000);
      ws.addEventListener(
        "close",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      ws.close();
    });
  if (child.exitCode === null)
    await new Promise((resolve) => {
      child.once("exit", resolve);
      child.kill();
    });
}
