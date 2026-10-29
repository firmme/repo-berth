// Node 24's built-in SQLite seeds only an isolated synthetic desktop profile.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { binaryDirectory } from "./app-config.mjs";

assert.equal(process.platform, "win32");
const root = resolve("bin/desktop-workspace-smoke", String(Date.now()));
await mkdir(join(root, "RepoBerth"), { recursive: true });
const db = new DatabaseSync(join(root, "RepoBerth", "berth.db"));
db.exec(
  "CREATE TABLE schema_version(version INTEGER NOT NULL); INSERT INTO schema_version VALUES(2)",
);
const now = new Date().toISOString();
const destination = "D:\\工作项目\\private checkout";
const accounts = ["personal", "work"].map((id, i) => ({
  id,
  provider: "github",
  host: "github.com",
  userId: i + 1,
  avatar: process.argv.includes("--online-avatars")
    ? `https://avatars.githubusercontent.com/u/${i ? 9919 : 583231}?v=4`
    : "",
  login: id,
  name: id,
  note: i ? "工作账号" : "个人账号",
  color: i ? "#8b6941" : "#1b6c80",
  status: "connected",
  credentialRef: "",
  sessionOnly: false,
}));
const profiles = accounts.map((a) => ({
  id: a.id + "-profile",
  accountId: a.id,
  name: a.id === "work" ? "Work Name" : "Personal Name",
  email: a.id + "@example.test",
}));
const gitEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !key.toUpperCase().startsWith("GIT_"),
  ),
);
Object.assign(gitEnv, {
  GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
});
const checkouts = [];
for (const owner of ["personal", "work"]) {
  const path = join(root, owner + " checkout");
  execFileSync("git", ["init", "-b", "main", path], {
    env: gitEnv,
    stdio: "pipe",
    windowsHide: true,
  });
  execFileSync(
    "git",
    [
      "-C",
      path,
      "remote",
      "add",
      "origin",
      "https://github.com/team/private.git",
    ],
    { env: gitEnv, windowsHide: true },
  );
  await writeFile(
    join(path, owner + ".txt"),
    "synthetic " + owner + " changes\n",
  );
  execFileSync("git", ["-C", path, "add", owner + ".txt"], {
    env: gitEnv,
    windowsHide: true,
  });
  checkouts.push({
    id: owner + "-copy",
    name: owner + " checkout",
    path,
    repositoryId: "private",
    favorite: owner === "personal",
    remotes: [{ name: "origin", url: "https://github.com/team/private.git" }],
  });
}
const payloads = {
  accounts,
  commit_profiles: profiles,
  remote_repositories: [
    {
      id: "private",
      provider: "github",
      host: "github.com",
      platformId: 42,
      owner: "team",
      name: "private",
      cloneUrl: "https://github.com/team/private.git",
      url: "https://github.com/team/private",
      private: true,
      language: "Go",
    },
  ],
  account_repositories: accounts.map((a) => ({
    id: a.id,
    accountId: a.id,
    repositoryId: "private",
    push: true,
    syncedAt: now,
  })),
  local_checkouts: checkouts,
  repository_bindings: accounts.map((a) => ({
    id: a.id + "-binding",
    checkoutId: a.id + "-copy",
    remote: "origin",
    accountId: a.id,
    profileId: a.id + "-profile",
    remoteURL: "https://github.com/team/private.git",
    pushURL: "https://github.com/team/private.git",
  })),
  groups: [
    {
      id: "organized",
      name: "重点项目",
      members: ["personal-copy", "work-copy", "private"],
    },
  ],
  credential_cleanup: [],
  tasks: [
    {
      id: "ownership-fixture",
      kind: "scan",
      target: root,
      state: "failed",
      errorCode: "SCAN_PARTIAL",
      error: "部分目录需要确认信任",
      startedAt: now,
      finishedAt: now,
      logs: [],
      scanSummary: {
        imported: 0,
        skipped: 1,
        issues: [{ path: "personal checkout", code: "DUBIOUS_OWNERSHIP" }],
      },
    },
    {
      id: "failed-push",
      kind: "push",
      target: "work-copy",
      state: "failed",
      errorCode: "AUTH_REQUIRED",
      error: "Synthetic authorization failure",
      startedAt: now,
      finishedAt: now,
      logs: [],
    },
    {
      id: "retry-fixture",
      kind: "clone",
      target: "private",
      state: "failed",
      errorCode: "AUTH_REQUIRED",
      error: "测试授权已失效，请重新授权后确认重试",
      startedAt: now,
      finishedAt: now,
      logs: [],
      cloneRequest: {
        accountId: "work",
        profileId: "work-profile",
        destination,
      },
    },
  ],
  settings: {
    gitPath: "git",
    clientId: "",
    cloneDirectory: "D:/other-default",
  },
};
for (const checkout of checkouts) {
  execFileSync(
    "git",
    [
      "-C",
      checkout.path,
      "-c",
      "user.name=Fixture Author",
      "-c",
      "user.email=fixture@example.test",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "Initial workspace",
    ],
    { env: gitEnv, windowsHide: true, stdio: "pipe" },
  );
  const owner = checkout.id.split("-")[0];
  await writeFile(
    join(checkout.path, owner + ".txt"),
    `// Repository identity\nexport const account = "${owner}";\nexport const credentialIsolation = true;\n`,
  );
}
for (const [table, payload] of Object.entries(payloads)) {
  db.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY,payload TEXT NOT NULL)`);
  db.prepare(`INSERT INTO ${table} VALUES('state',?)`).run(
    JSON.stringify(payload),
  );
}
db.close();
const executable = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(binaryDirectory, "RepoBerth.exe");
const child = spawn(executable, ["--devtools-port=9240"], {
  env: { ...process.env, APPDATA: root },
  windowsHide: true,
  stdio: "ignore",
});
let ws;
try {
  let target;
  for (let i = 0; i < 150; i++) {
    try {
      target = (
        await (await fetch("http://127.0.0.1:9240/json/list")).json()
      ).find((t) => t.url === "http://wails.localhost/");
    } catch {}
    if (target) break;
    if (child.exitCode !== null) throw new Error("Application exited");
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(target, "Native WebView not available");
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let sequence = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const message = JSON.parse(e.data);
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
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("CDP timeout: " + method));
      }, 15000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails)
      throw new Error(
        r.exceptionDetails.exception?.description || r.exceptionDetails.text,
      );
    return r.result?.value;
  };
  const until = async (expression) => {
    for (let i = 0; i < 150; i++) {
      if (await evaluate(expression)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("UI did not reach: " + expression);
  };
  const click = async (selector) =>
    evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('Missing control');e.click()})()`,
    );
  const textButton = async (text) =>
    evaluate(
      `(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw new Error('Missing button '+${JSON.stringify(text)});b.click()})()`,
    );
  const fill = async (selector, value) =>
    evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    );
  const capture = async (name) => {
    await evaluate(
      `new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
    );
    const p = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(
      resolve("bin/" + name + ".png"),
      Buffer.from(p.data, "base64"),
    );
  };
  await until(
    `!!document.querySelector('.desktop-shell') && !document.querySelector('.desktop-fatal')`,
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await textButton("文件");
  assert(
    await evaluate(
      `Array.from(document.querySelectorAll('.menu-popover > button')).every(b=>{const range=document.createRange();range.selectNodeContents(b);return getComputedStyle(b).justifyContent==='flex-start' && range.getBoundingClientRect().left-b.getBoundingClientRect().left<20})`,
    ),
    "Menu labels are not left aligned",
  );
  await capture("desktop-menu-left");
  await textButton("文件");
  await click(".account-unit>button");
  await evaluate(
    `Array.from(document.querySelectorAll('.account-choice')).find(b=>b.querySelector('strong').textContent==='work').click()`,
  );
  await until(
    `document.querySelector('.account-unit strong')?.textContent==='work'`,
  );
  assert.equal(
    await evaluate(
      `!!document.querySelector('.repository-popover,dialog[open]')`,
    ),
    false,
  );
  await click(".repository-unit>button");
  await click(".scope-picker-trigger");
  await until(
    `document.querySelectorAll('.scope-picker-options [role="menuitemradio"]').length>=8`,
  );
  assert(
    await evaluate(
      `Array.from(document.querySelectorAll('.scope-picker-options [role="menuitemradio"]')).every(b=>b.querySelector('svg,.account-avatar'))`,
    ),
  );
  if (process.argv.includes("--online-avatars"))
    await until(
      `Array.from(document.querySelectorAll('.scope-picker-options img')).length===2 && Array.from(document.querySelectorAll('.scope-picker-options img')).every(i=>i.complete&&i.naturalWidth>0)`,
    );
  await capture("desktop-type-filter");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  assert(
    await evaluate(
      `document.documentElement.scrollWidth<=innerWidth+1 && document.querySelector('.scope-picker-options').getBoundingClientRect().right<=innerWidth`,
    ),
    "Type dropdown overflows narrow window",
  );
  await capture("desktop-type-filter-390");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate(
    `Array.from(document.querySelectorAll('.scope-picker-options button')).find(b=>b.textContent==='全部仓库').click()`,
  );
  await until(`document.querySelectorAll('.repository-row').length===2`);
  await capture("desktop-repository-picker");
  await evaluate(
    `Array.from(document.querySelectorAll('.repository-row')).find(b=>b.textContent.includes('personal checkout')).click()`,
  );
  await until(
    `document.querySelector('.desktop-file-row')?.innerText.includes('personal.txt')`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('.account-unit strong').textContent`,
    ),
    "personal",
  );
  await click(".file-name");
  await until(
    `document.querySelector('.desktop-diff')?.innerText.includes('credentialIsolation')`,
  );
  await capture("desktop-changes");
  await click(".desktop-file-row input[type=checkbox]");
  await until(`document.querySelector('.desktop-file-row input').checked`);
  await fill('input[aria-label="提交摘要"]', "Isolate repository identity");
  await fill(
    'textarea[aria-label="提交描述"]',
    "Keep the correct account for each local copy.",
  );
  await until(
    `document.querySelector('.desktop-diff')?.innerText.includes('credentialIsolation')`,
  );
  await click(".account-unit>button");
  await capture("desktop-account-switcher");
  if (process.argv.includes("--online-avatars")) {
    await until(
      `Array.from(document.querySelectorAll('.account-avatar img')).length>=4 && Array.from(document.querySelectorAll('.account-avatar img')).every(i=>i.complete && i.naturalWidth>0)`,
    );
    await capture("desktop-account-avatars");
  }
  await evaluate(
    `Array.from(document.querySelectorAll('.account-choice')).find(b=>b.querySelector('strong').textContent==='work').click()`,
  );
  await until(
    `document.querySelector('.account-unit strong')?.textContent==='work'`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('input[aria-label="提交摘要"]').value`,
    ),
    "Isolate repository identity",
  );
  assert.equal(
    await evaluate(
      `document.querySelector('.desktop-diff-header')?.innerText.includes('personal.txt')`,
    ),
    true,
  );
  assert.equal(
    await evaluate(
      `!!document.querySelector('.repository-popover,dialog[open]')`,
    ),
    false,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('.commit-identity')?.innerText.includes('Personal Name')`,
    ),
    true,
  );
  await capture("desktop-account-operation-only");
  await click(".account-unit>button");
  await evaluate(
    `Array.from(document.querySelectorAll('.account-choice')).find(b=>b.querySelector('strong').textContent==='personal').click()`,
  );
  await until(
    `document.querySelector('.account-unit strong')?.textContent==='personal'`,
  );
  await click(".repository-unit>button");
  await evaluate(
    `Array.from(document.querySelectorAll('.repository-row')).find(b=>b.textContent.includes('work checkout')).click()`,
  );
  await until(
    `document.querySelector('.account-unit strong')?.textContent==='work'`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('input[aria-label="提交摘要"]').value`,
    ),
    "",
  );
  assert.equal(
    await evaluate(`!!document.querySelector('.desktop-diff')`),
    false,
  );
  await click(".repository-unit>button");
  await evaluate(
    `Array.from(document.querySelectorAll('.repository-row')).find(b=>b.textContent.includes('personal checkout')).click()`,
  );
  await until(
    `document.querySelector('input[aria-label="提交摘要"]')?.value==='Isolate repository identity'`,
  );
  await until(`!document.querySelector('.desktop-primary').disabled`);
  const personal = checkouts.find((c) => c.id === "personal-copy");
  const lockPath = join(personal.path, ".git", "index.lock");
  await writeFile(lockPath, "synthetic lock fixture");
  await click(".desktop-primary");
  await textButton("任务中心");
  await until(
    `Array.from(document.querySelectorAll('.task-row')).some(r=>r.querySelector('strong')?.textContent==='提交' && r.querySelector('.task-state')?.textContent==='失败')`,
  );
  await click('button[aria-label="关闭任务中心"]');
  await until(`!document.querySelector('.desktop-primary').disabled`);
  assert.equal(
    await evaluate(
      `document.querySelector('input[aria-label="提交摘要"]').value`,
    ),
    "Isolate repository identity",
  );
  assert.equal(
    await evaluate(
      `document.querySelector('textarea[aria-label="提交描述"]').value`,
    ),
    "Keep the correct account for each local copy.",
  );
  await unlink(lockPath);
  await click(".desktop-primary");
  await until(
    `document.querySelector('input[aria-label="提交摘要"]')?.value===''`,
  );
  assert.equal(
    execFileSync(
      "git",
      ["-C", personal.path, "log", "-1", "--format=%an <%ae>"],
      { env: gitEnv, encoding: "utf8", windowsHide: true },
    ).trim(),
    "Personal Name <personal@example.test>",
  );
  await click(".desktop-tabs button:nth-child(2)");
  await until(
    `document.querySelectorAll('.desktop-history-list>button').length===2`,
  );
  await click(".desktop-history-list>button");
  await until(
    `document.querySelector('.desktop-diff')?.innerText.includes('credentialIsolation')`,
  );
  await capture("desktop-history");
  assert(
    await evaluate(
      `Array.from(document.querySelectorAll('.desktop-history-list > button')).every(b=>{const r=b.getBoundingClientRect();return r.height>=64 && Array.from(b.querySelectorAll('strong,small')).every(e=>{const c=e.getBoundingClientRect();return c.top>=r.top && c.bottom<=r.bottom})})`,
    ),
    "History content exceeds highlight bounds",
  );
  await click(".desktop-history-list > button:nth-child(2)");
  assert.equal(
    await evaluate(
      `document.querySelector('.desktop-history-list > button:nth-child(2)').classList.contains('selected')`,
    ),
    true,
  );
  await capture("desktop-history-selected");
  await click(".branch-unit>button");
  await until(`!!document.querySelector('input[aria-label="新分支名称"]')`);
  await fill('input[aria-label="新分支名称"]', "desktop-layout");
  await textButton("新建分支");
  await until(
    `document.querySelector('.branch-unit strong')?.textContent==='desktop-layout'`,
  );
  await click(".desktop-tabs button:first-child");
  await until(
    `document.querySelector('.desktop-start h2')?.textContent==='没有本地变更'`,
  );
  await capture("desktop-clean");
  await click(".account-unit>button");
  await textButton("添加 / 管理账号");
  await until(`!!document.querySelector('dialog[open]')`);
  assert.equal(
    await evaluate(
      `document.querySelector('dialog').innerText.includes('OAuth Client ID')`,
    ),
    false,
  );
  await capture("desktop-accounts");
  await click('dialog button[aria-label="关闭"]');
  await textButton("任务中心");
  await evaluate(
    `Array.from(document.querySelectorAll('.task-row')).find(r=>r.innerText.includes('已恢复上次克隆') || r.innerText.includes('测试授权已失效')).querySelector('button:last-child').click()`,
  );
  await until(`!!document.querySelector('dialog[open] form')`);
  const retry = await evaluate(
    `(()=>{const f=document.querySelector('dialog form');return {account:f.querySelectorAll('select')[0].value,profile:f.querySelectorAll('select')[1].value,inputs:Array.from(f.querySelectorAll('input')).map(i=>i.value),text:f.innerText}})()`,
  );
  assert.equal(retry.account, "work");
  assert.equal(retry.profile, "work-profile");
  assert.deepEqual(retry.inputs, ["D:\\工作项目", "private checkout"]);
  assert(retry.text.includes("已恢复上次克隆"));
  await capture("desktop-clone-retry");
  await click('dialog button[aria-label="关闭"]');
  await click('button[aria-label="关闭任务中心"]');
  // Runtime bridge validation for the new history endpoint, using the actual
  // shipped host; no credentials or network access are needed by this fixture.
  await evaluate(
    `(async()=>{for(const url of performance.getEntriesByType('resource').map(r=>r.name).filter(n=>n.endsWith('.js'))){const m=await import(url);const call=Object.values(m).find(v=>v&&typeof v.ByName==='function');if(call){window.__desktopCall=call;return}}throw new Error('Wails bridge unavailable')})()`,
  );
  assert.equal(
    await evaluate(
      `(async()=>{try{await window.__desktopCall.ByName('repo-berth/internal/service.Service.GitCommitDiff','personal-copy','--help');return false}catch(e){return String(e).includes('INVALID_COMMIT')}})()`,
    ),
    true,
  );
  const latest = await evaluate(
    `window.__desktopCall.ByName('repo-berth/internal/service.Service.Snapshot')`,
  );
  assert.equal(latest.githubAuthConfigured, true);
  assert.equal(latest.settings.clientId, "");
  // Defaults affect inherited projects; explicit project information takes precedence.
  await evaluate(
    `window.__desktopCall.ByName('repo-berth/internal/service.Service.SaveSettings',${JSON.stringify({ ...payloads.settings, defaultCommitName: "Default Author", defaultCommitEmail: "default@example.test" })})`,
  );
  await until(
    `document.querySelector('.commit-identity')?.innerText.includes('Default Author')`,
  );
  await evaluate(
    `window.__desktopCall.ByName('repo-berth/internal/service.Service.SetCheckoutIdentity','personal-copy','Project Author','project@example.test')`,
  );
  await until(
    `document.querySelector('.commit-identity')?.innerText.includes('Project Author')`,
  );
  await evaluate(
    `window.__desktopCall.ByName('repo-berth/internal/service.Service.SetCheckoutIdentity','personal-copy','','')`,
  );
  await until(
    `document.querySelector('.commit-identity')?.innerText.includes('Default Author')`,
  );
  const plainPath = join(root, "ordinary notes");
  await mkdir(plainPath, { recursive: true });
  await writeFile(join(plainPath, "keep.txt"), "precious notes");
  await textButton("文件");
  await textButton("添加本地仓库…");
  await fill("dialog .joined input", plainPath);
  await textButton("开始导入");
  await until(
    `document.querySelector('dialog')?.innerText.includes('这个目录不是 Git 仓库')`,
  );
  await capture("desktop-plain-confirmation");
  await textButton("继续添加普通目录");
  await until(`!!document.querySelector('.desktop-plain-directory')`);
  assert(
    await evaluate(`document.querySelector('.branch-unit > button').disabled`),
  );
  await capture("desktop-plain-directory");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  assert(
    await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`),
    "Plain directory overflows narrow window",
  );
  await capture("desktop-plain-directory-390");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await textButton("文件");
  await textButton("管理本地目录…");
  await until(`document.querySelectorAll('.local-management-row').length===3`);
  await evaluate(
    `Array.from(document.querySelectorAll('.local-management-row')).filter(r=>r.innerText.includes('ordinary notes')||r.innerText.includes('work checkout')).forEach(r=>r.querySelector('input').click())`,
  );
  await textButton("移出管理（2）");
  await capture("desktop-bulk-remove");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await capture("desktop-bulk-remove-390");
  assert(
    await evaluate(
      `document.querySelector('dialog').scrollWidth<=document.querySelector('dialog').clientWidth+1`,
    ),
    "Bulk confirmation overflows dialog",
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await textButton("确认移出管理（2）");
  await until(`document.querySelectorAll('.local-management-row').length===1`);
  assert.equal(
    execFileSync(
      "git",
      [
        "-C",
        checkouts.find((c) => c.id === "work-copy").path,
        "status",
        "--porcelain",
      ],
      { env: gitEnv, encoding: "utf8", windowsHide: true },
    ).trim().length > 0,
    true,
  );
  const { readFile } = await import("node:fs/promises");
  assert.equal(
    await readFile(join(plainPath, "keep.txt"), "utf8"),
    "precious notes",
  );
  await click('dialog button[aria-label="关闭"]');
  await click(".repository-unit > button");
  await click(".repository-row");
  await until(`!!document.querySelector('.desktop-start')`);
  // Compact widths remain usable without page-level horizontal overflow.
  for (const width of [768, 390]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await capture("desktop-clean-" + width);
    assert(
      await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`),
      "Horizontal overflow at " + width,
    );
  }
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await textButton("任务中心");
  assert.equal(
    await evaluate(`document.body.innerText.includes('确认目录信任')`),
    false,
  );
  await evaluate(
    `Array.from(document.querySelectorAll('.task-row')).find(r=>r.innerText.includes('部分目录需要确认信任')).querySelector('button:last-child').click()`,
  );
  await until(
    `window.__desktopCall.ByName('repo-berth/internal/service.Service.Snapshot').then(s=>s.tasks.some(t=>t.kind==='scan'&&t.id!=='ownership-fixture'&&t.state==='succeeded'))`,
  );
  assert.equal(
    await evaluate(`!!document.querySelector('dialog[open]')`),
    false,
  );
  console.log(
    "PASS: Desktop workspace, isolated accounts/drafts, commit recovery, history highlight geometry, default/project identities, explicit plain-directory import, atomic batch removal preserving files, clone retry and responsive geometry",
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
