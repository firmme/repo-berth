// Node 24's built-in SQLite seeds only an isolated synthetic desktop profile.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn, execFileSync } from "node:child_process";

assert.equal(process.platform, "win32");
const root = resolve("bin/clone-retry-smoke", String(Date.now()));
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
  login: id,
  name: id,
  note: i ? "工作账号" : "个人账号",
  color: i ? "#8b6941" : "#1b6c80",
  status: "auth_required",
  credentialRef: "",
  sessionOnly: true,
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
for (const [table, payload] of Object.entries(payloads)) {
  db.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY,payload TEXT NOT NULL)`);
  db.prepare(`INSERT INTO ${table} VALUES('state',?)`).run(
    JSON.stringify(payload),
  );
}
db.close();
const executable = process.argv[2]
  ? resolve(process.argv[2])
  : resolve("bin/RepoBerth.exe");
const child = spawn(executable, ["--devtools-port=9239"], {
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
        await (await fetch("http://127.0.0.1:9239/json/list")).json()
      ).find((t) => t.url === "http://wails.localhost/");
    } catch {}
    if (target) break;
    if (child.exitCode !== null) throw new Error("Application exited");
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(target, "No native WebView");
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let sequence = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    const p = pending.get(m.id);
    if (p) {
      pending.delete(m.id);
      clearTimeout(p.timer);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(
        () => reject(new Error("CDP timeout: " + method)),
        10000,
      );
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
  async function until(expression) {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("UI condition did not appear: " + expression);
  }
  await until(`document.body?.innerText?.includes('2 个 GitHub 账号')`);
  assert.equal(
    await evaluate(
      `document.body.innerText.includes('此构建缺少 GitHub 登录配置')`,
    ),
    false,
    "Application OAuth config was not embedded",
  );
  for (const label of ["收藏", "重点项目"]) {
    await evaluate(
      `Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
    );
    await until(
      `document.querySelector('.repository-row strong')?.textContent==='private'`,
    );
    assert.equal(
      await evaluate(`document.querySelectorAll('.repository-row').length`),
      1,
    );
  }
  await evaluate(
    `Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()==='全部仓库').click()`,
  );
  await evaluate(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('任务中心')).click()`,
  );
  await until(
    `Array.from(document.querySelectorAll('.task-row button')).some(b=>b.textContent==='重试')`,
  );
  await evaluate(
    `Array.from(document.querySelectorAll('.task-row button')).find(b=>b.textContent==='重试').click()`,
  );
  await until(`!!document.querySelector('dialog[open] form')`);
  const values = await evaluate(
    `(()=>{const f=document.querySelector('dialog form');return {account:f.querySelectorAll('select')[0].value,profile:f.querySelectorAll('select')[1].value,inputs:Array.from(f.querySelectorAll('input')).map(i=>i.value),notice:f.innerText}})()`,
  );
  assert.equal(values.account, "work");
  assert.equal(values.profile, "work-profile");
  assert.deepEqual(values.inputs, ["D:\\工作项目", "private checkout"]);
  assert(values.notice.includes("已恢复上次克隆"));
  const screenshot = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    resolve("bin/clone-retry-desktop.png"),
    Buffer.from(screenshot.data, "base64"),
  );
  for (const [width, height] of [
    [1440, 900],
    [768, 1024],
    [390, 844],
  ]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate(
      `new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
    );
    const box = await evaluate(
      `(()=>{const d=document.querySelector('dialog[open]');const b=d.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:innerWidth,height:innerHeight,scrollWidth:d.scrollWidth,clientWidth:d.clientWidth}})()`,
    );
    assert(
      box.left >= 0 &&
        box.right <= box.width + 1 &&
        box.top >= 0 &&
        box.bottom <= box.height + 1,
      JSON.stringify(box),
    );
    assert(
      box.scrollWidth <= box.clientWidth + 1,
      "Clone dialog overflows horizontally",
    );
    const picture = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(
      resolve(`bin/clone-retry-${width}.png`),
      Buffer.from(picture.data, "base64"),
    );
  }
  // Merely inspecting a retry must not start another task or touch the network.
  assert.equal(
    await evaluate(`document.querySelectorAll('.task-row').length`),
    2,
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate(
    `document.querySelector('dialog[open] button[aria-label="关闭"]').click()`,
  );
  await evaluate(
    `Array.from(document.querySelectorAll('.task-row button')).find(b=>b.textContent==='查看本地副本').click()`,
  );
  await until(
    `document.querySelector('.checkout-picker select')?.value==='work-copy'`,
  );
  await evaluate(
    `Array.from(document.querySelectorAll('[role="tab"]')).find(b=>b.textContent.startsWith('变更')).click()`,
  );
  await until(`!!document.querySelector('.file-name')`);
  const setDraft = async (message) =>
    evaluate(
      `(()=>{const t=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(message)});t.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    );
  const pickCopy = async (id) => {
    await evaluate(
      `(()=>{const s=document.querySelector('.checkout-picker select');s.value=${JSON.stringify(id)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`,
    );
    await until(
      `document.querySelector('.checkout-picker select')?.value===${JSON.stringify(id)}`,
    );
  };
  await setDraft("work draft");
  await evaluate(`document.querySelector('.file-name').click()`);
  await until(
    `document.querySelector('.diff-view')?.innerText.includes('work.txt')`,
  );
  await pickCopy("personal-copy");
  assert.equal(await evaluate(`document.querySelector('textarea').value`), "");
  assert.equal(await evaluate(`!!document.querySelector('.diff-view')`), false);
  await setDraft("personal draft");
  await pickCopy("work-copy");
  assert.equal(
    await evaluate(`document.querySelector('textarea').value`),
    "work draft",
  );
  const commitButton = `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='提交')`;
  await until(`!${commitButton}?.disabled`);
  const work = checkouts.find((c) => c.id === "work-copy");
  // An actual Git lock failure must retain the draft; removing the fixture lock
  // then allows the same local-only commit to succeed with the bound identity.
  const lockPath = join(work.path, ".git", "index.lock");
  await writeFile(lockPath, "synthetic lock fixture");
  await evaluate(`${commitButton}.click()`);
  await evaluate(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('任务中心')).click()`,
  );
  await until(
    `Array.from(document.querySelectorAll('.task-row')).some(r=>r.querySelector('strong')?.textContent==='提交' && r.querySelector('.task-state')?.textContent==='失败')`,
  );
  await evaluate(
    `document.querySelector('button[aria-label="关闭任务中心"]').click()`,
  );
  await until(`!${commitButton}?.disabled`);
  assert.equal(
    await evaluate(`document.querySelector('textarea').value`),
    "work draft",
  );
  await unlink(lockPath);
  await evaluate(`${commitButton}.click()`);
  await until(`document.querySelector('textarea')?.value===''`);
  const author = execFileSync(
    "git",
    ["-C", work.path, "log", "-1", "--format=%an <%ae>"],
    { env: gitEnv, encoding: "utf8", windowsHide: true },
  ).trim();
  assert.equal(author, "Work Name <work@example.test>");
  await pickCopy("personal-copy");
  assert.equal(
    await evaluate(`document.querySelector('textarea').value`),
    "personal draft",
  );
  const workspace = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    resolve("bin/multiple-checkouts.png"),
    Buffer.from(workspace.data, "base64"),
  );
  await evaluate(
    `Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.includes('工作账号')).click()`,
  );
  await until(`!!document.querySelector('.repository-row')`);
  await evaluate(`document.querySelector('.repository-row').click()`);
  await until(
    `document.querySelector('.checkout-picker select')?.value==='work-copy'`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('.identity-lanes strong').textContent`,
    ),
    "work",
  );
  await evaluate(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='新建副本').click()`,
  );
  await until(`!!document.querySelector('dialog[open] form')`);
  assert.equal(
    await evaluate(`document.querySelector('dialog form select').value`),
    "work",
  );
  assert.equal(
    await evaluate(`document.querySelectorAll('dialog form select')[1].value`),
    "work-profile",
  );
  assert.equal(
    await evaluate(
      `document.querySelector('dialog form').innerText.includes('已恢复上次克隆')`,
    ),
    false,
  );
  const scopedClone = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    resolve("bin/account-scoped-clone.png"),
    Buffer.from(scopedClone.data, "base64"),
  );
  await evaluate(
    `document.querySelector('dialog[open] button[aria-label="关闭"]').click()`,
  );
  execFileSync(
    "git",
    [
      "-C",
      work.path,
      "remote",
      "add",
      "upstream",
      "https://github.com/team/private.git",
    ],
    { env: gitEnv, windowsHide: true },
  );
  execFileSync("git", ["-C", work.path, "remote", "remove", "origin"], {
    env: gitEnv,
    windowsHide: true,
  });
  await evaluate(
    `document.querySelector('button[aria-label="刷新仓库状态"]').click()`,
  );
  await until(
    `document.querySelector('select[aria-label="选择 remote"]')?.value==='' && document.body.innerText.includes('remote「origin」当前不存在')`,
  );
  assert.equal(
    await evaluate(
      `Array.from(document.querySelectorAll('.git-actions button')).every(b=>b.disabled)`,
    ),
    true,
  );
  const missingRemote = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    resolve("bin/missing-remote.png"),
    Buffer.from(missingRemote.data, "base64"),
  );
  await evaluate(
    `(()=>{const s=document.querySelector('select[aria-label="选择 remote"]');s.value='upstream';s.dispatchEvent(new Event('change',{bubbles:true}))})()`,
  );
  await until(
    `document.querySelector('select[aria-label="选择 remote"]')?.value==='upstream'`,
  );
  await pickCopy("personal-copy");
  assert.equal(
    await evaluate(
      `document.querySelector('select[aria-label="选择 remote"]').value`,
    ),
    "origin",
  );
  await pickCopy("work-copy");
  assert.equal(
    await evaluate(
      `document.querySelector('select[aria-label="选择 remote"]').value`,
    ),
    "upstream",
  );
  const scanRoot = join(root, "scan fixtures");
  const broken = join(scanRoot, "a-broken");
  await mkdir(broken, { recursive: true });
  await writeFile(join(broken, ".git"), "gitdir: missing-fixture-path");
  const scanLinked = join(scanRoot, "b-linked");
  execFileSync(
    "git",
    ["-C", work.path, "worktree", "add", "--detach", scanLinked],
    { env: gitEnv, windowsHide: true, stdio: "pipe" },
  );
  await evaluate(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='导入本地').click()`,
  );
  await until(`!!document.querySelector('dialog[open] form')`);
  await evaluate(
    `(()=>{const f=document.querySelector('dialog form');const i=f.querySelector('input:not([type="checkbox"])');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(scanRoot)});i.dispatchEvent(new Event('input',{bubbles:true}));f.querySelector('input[type="checkbox"]').click()})()`,
  );
  await evaluate(
    `Array.from(document.querySelectorAll('dialog button')).find(b=>b.textContent.trim()==='开始导入').click()`,
  );
  await until(
    `Array.from(document.querySelectorAll('.task-row')).some(r=>r.innerText.includes('SCAN_PARTIAL') && r.innerText.includes('扫描结果：导入/更新 1，跳过 1'))`,
  );
  await evaluate(
    `Array.from(document.querySelectorAll('.task-row')).find(r=>r.innerText.includes('SCAN_PARTIAL')).querySelector('summary').click()`,
  );
  assert.equal(
    await evaluate(
      `Array.from(document.querySelectorAll('.task-row')).find(r=>r.innerText.includes('SCAN_PARTIAL')).innerText.includes('a-broken · 不是有效的 Git 仓库')`,
    ),
    true,
  );
  const scanPicture = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    resolve("bin/scan-partial.png"),
    Buffer.from(scanPicture.data, "base64"),
  );
  await evaluate(
    `document.querySelector('button[aria-label="关闭任务中心"]').click()`,
  );
  await evaluate(
    `Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.trim()==='设置').click()`,
  );
  await until(
    `!!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='管理 GitHub 账号')`,
  );
  assert.equal(
    await evaluate(`document.body.innerText.includes('OAuth Client ID')`),
    false,
  );
  await evaluate(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='管理 GitHub 账号').click()`,
  );
  await until(
    `!!Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='添加 GitHub 账号')`,
  );
  assert.equal(
    await evaluate(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='添加 GitHub 账号').disabled`,
    ),
    false,
  );
  const loginReady = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    resolve("bin/login-ready.png"),
    Buffer.from(loginReady.data, "base64"),
  );
  console.log(
    "PASS: native clone retry, task navigation, isolated drafts/diffs, commit recovery, account scope, remote removal and partial scan with a real linked worktree",
  );
} finally {
  if (ws && ws.readyState < WebSocket.CLOSING) {
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
  }
  if (child.exitCode === null) {
    await new Promise((resolve) => {
      child.once("exit", resolve);
      child.kill();
    });
  }
}
