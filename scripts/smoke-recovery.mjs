// All destructive checks run only in this script's generated throwaway repo.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { binaryDirectory } from "./app-config.mjs";

assert.equal(process.platform, "win32");
const root = resolve("bin/recovery-smoke", String(Date.now()));
const repo = join(root, "repository");
assert(repo.startsWith(root + sep));
await mkdir(repo, { recursive: true });
const emptyConfig = join(root, "empty.gitconfig"); await writeFile(emptyConfig, "");
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
Object.assign(env, { GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" });
const git = (...args) => execFileSync("git", ["-c", "user.name=Smoke", "-c", "user.email=smoke@example.test", ...args], { cwd: repo, env, windowsHide: true, encoding: "utf8" }).trim();
git("init", "-b", "main"); git("config", "core.autocrlf", "false"); git("config", "core.eol", "lf");
await writeFile(join(repo, "one.txt"), "base\n"); git("add", "."); git("commit", "-m", "base commit"); const base = git("rev-parse", "HEAD");
await writeFile(join(repo, "one.txt"), "second commit\n"); git("add", "."); git("commit", "-m", "second commit");
await writeFile(join(repo, "one.txt"), "working edits\n"); await writeFile(join(repo, "new.txt"), "untracked work\n");
const child = spawn(join(binaryDirectory, "RepoBerth.exe"), ["--devtools-port=9244"], { env: { ...process.env, APPDATA: root }, windowsHide: true, stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
try {
  let target;
  for (let i = 0; i < 150; i++) { try { target = (await (await fetch("http://127.0.0.1:9244/json/list")).json()).find((t) => t.url === "http://wails.localhost/"); } catch {} if (target) break; await sleep(100); }
  assert(target, "No isolated WebView"); ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data), p = pending.get(m.id); if (p) { pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const current = ++id, timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 15000); pending.set(current, { resolve, reject, timer }); ws.send(JSON.stringify({ id: current, method, params })); });
  const evaluate = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result?.value; };
  const until = async (expression) => { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await sleep(100); } throw new Error("UI timeout: " + expression); };
  const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const button = (text) => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw new Error('Missing button');b.click()})()`);
  const capture = async (name) => { const img = await send("Page.captureScreenshot", { format: "png" }); await writeFile(join(root, name + ".png"), Buffer.from(img.data, "base64")); };
  await until(`!!document.querySelector('.desktop-shell') && !document.querySelector('.desktop-fatal')`);
  await evaluate(`(async()=>{for(const r of performance.getEntriesByType('resource').filter(r=>r.name.endsWith('.js'))){const m=await import(r.name),c=Object.values(m).find(v=>v&&typeof v.ByName==='function');if(c){window.__recoveryCall=c;return}}throw new Error('No Wails Call')})()`);
  const call = (name, ...args) => evaluate(`window.__recoveryCall.ByName(${JSON.stringify("repo-berth/internal/service.Service." + name)},...${JSON.stringify(args)})`);
  assert.equal((await call("Snapshot")).checkouts.length, 0, "Refusing to touch a non-empty application profile");
  const checkout = await call("ImportCheckout", repo);
  await click(".repository-unit>button"); await until(`!!document.querySelector('.repository-row')`); await click(".repository-row");
  await until(`!!document.querySelector('.tree-file .file-name[title="one.txt"]')`);
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate(`document.querySelector('.tree-file .file-name[title="one.txt"]').closest('.tree-file').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:180,clientY:240}))`);
  await button("丢弃文件修改…"); await until(`document.querySelector('.recovery-files')?.textContent.includes('one.txt')`);
  await capture("discard-file");
  assert(await evaluate(`[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='确认丢弃修改').disabled`));
  await button("取消"); assert.equal(await readFile(join(repo,"one.txt"),"utf8"), "working edits\n");
  await click('[aria-label="丢弃全部未提交修改"]'); await until(`!!document.querySelector('.recovery-files li')`);
  assert(!(await evaluate(`document.querySelector('.recovery-files').textContent`)).includes("new.txt"));
  await evaluate(`document.querySelectorAll('.recovery-check input')[0].click()`); await until(`document.querySelector('.recovery-files')?.textContent.includes('new.txt')`);
  await send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 900, deviceScaleFactor: 1, mobile: false });
  assert(await evaluate(`(()=>{const d=document.querySelector('dialog[open]'),r=d.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&d.scrollWidth<=d.clientWidth+1})()`)); await capture("discard-all-1024");
  await button("取消");
  await button("历史"); await until(`[...document.querySelectorAll('.desktop-history-list button strong')].some(e=>e.textContent==='base commit')`);
  await evaluate(`[...document.querySelectorAll('.desktop-history-list button')].find(b=>b.textContent.includes('base commit')).click()`);
  await button("重置到此提交…"); await until(`!!document.querySelector('.recovery-files')`);
  assert(await evaluate(`document.querySelector('input[value="mixed"]').checked`)); await capture("reset-mixed");
  await click('input[value="hard"]'); await until(`!!document.querySelector('.recovery-check input:not(:disabled)')`); await capture("reset-hard"); await button("取消");
  const document = await call("ReadWorkingDocument", checkout, "one.txt");
  assert.equal(document.content, "working edits\n");
  await writeFile(join(repo, "one.txt"), "external edit\n");
  await assert.rejects(() => call("SaveWorkingDocument", checkout, "one.txt", "app edit\n", document.version), /FILE_CHANGED|磁盘文件已修改/);
  assert.equal(await readFile(join(repo, "one.txt"), "utf8"), "external edit\n");

  // Exercise the same service bridge on the generated repository only.
  const req = { kind: "reset", paths: [], all: false, includeUntracked: false, target: base, mode: "hard" };
  const preview = await call("PreviewGitRecovery", checkout, req);
  await call("ApplyGitRecovery", checkout, req, preview.fingerprint);
  assert.equal(git("rev-parse", "HEAD"), base); assert.equal(await readFile(join(repo,"one.txt"),"utf8"),"base\n"); assert.equal(await readFile(join(repo,"new.txt"),"utf8"),"untracked work\n");
  console.log("PASS: native discard entry points, cancel preserves data, untracked opt-in, reset modes, layout, stale editor save protection, and confirmed hard reset through Wails on isolated repo"); console.log(root);
} finally { if (ws && ws.readyState < 2) ws.close(); child.kill(); }
