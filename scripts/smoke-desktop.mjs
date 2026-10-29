// Run against an isolated desktop process started with --devtools-port=9237.
// The process must use a throwaway APPDATA/XDG_CONFIG_HOME, not your normal data.
import assert from 'node:assert/strict';
import { mkdir, writeFile,readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync,execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const targets=await (await fetch('http://127.0.0.1:9237/json/list')).json();
const target=targets.find(t=>t.url==='http://wails.localhost/');
assert(target,'No Repo Berth WebView found');
const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
let sequence=0;const pending=new Map();
ws.onmessage=event=>{const message=JSON.parse(event.data);const p=pending.get(message.id);if(p){pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(new Error(message.error.message)):p.resolve(message.result)}};
function send(method,params={}){const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Timed out: ${method}`))},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))})}
async function evaluate(expression){const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result?.value}
async function call(method,...args){return evaluate(`window.__berthSmokeCall.ByName(${JSON.stringify('repo-berth/internal/service.Service.'+method)},...${JSON.stringify(args)})`)}
try{
 await send('Runtime.enable');
 assert.equal(await evaluate(`Boolean(window.chrome?.webview?.postMessage)`),true);
 assert.equal(await evaluate(`Boolean(document.querySelector('.preview-notice'))`),false,'Desktop incorrectly fell back to preview');
 await evaluate(`(async()=>{const resources=performance.getEntriesByType('resource').map(r=>r.name).filter(n=>n.endsWith('.js'));for(const url of resources){const m=await import(url);const call=Object.values(m).find(v=>v&&typeof v.ByName==='function');if(call){window.__berthSmokeCall=call;return true}}throw new Error('Runtime Call export not found')})()`);
 const state=await call('Snapshot');assert(Array.isArray(state.accounts));assert.match(await call('GitVersion'),/^git version/);
 assert.equal(typeof state.pendingCredentialCleanupCount,'number');assert(!('credentialCleanup' in state),'Private cleanup ledger exposed through Wails');
 await assert.rejects(()=>call('RecoverAuthorization','not-a-real-authorization',true),/AUTH_RECOVERY_EXPIRED/);
 await assert.rejects(()=>call('OpenGitHubPage','unrecognized'),/INVALID_OPERATION/);
 // Verify the shipped GUI executable also works as a non-UI credential helper
 // over inherited pipes, with isolated fake credentials (no GitHub traffic).
 const exe=resolve('bin/RepoBerth.exe').replaceAll('\\','/');
 for(const identity of [{login:'personal',token:'smoke-personal-token'},{login:'work',token:'smoke-work-token'}]){
  const nonce=randomBytes(32).toString('hex');const server=createServer(async(req,res)=>{let data='';for await(const chunk of req)data+=chunk;const request=JSON.parse(data);if(req.headers.authorization!==`Bearer ${nonce}`||request.host!=='github.com'||request.path!=='org/project.git'){res.writeHead(403);res.end();return}res.setHeader('content-type','application/json');res.end(JSON.stringify({username:identity.login,password:identity.token}))});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{const quoted="'"+exe.replaceAll("'","'\\''")+"'";const output=await new Promise((resolve,reject)=>{const child=execFile('git',['-c','credential.helper=','-c',`credential.helper=!${quoted} --credential-helper`,'-c','credential.useHttpPath=true','credential','fill'],{windowsHide:true,timeout:10000,env:{...process.env,GIT_TERMINAL_PROMPT:'0',BERTH_CREDENTIAL_ENDPOINT:`http://127.0.0.1:${server.address().port}/credential`,BERTH_CREDENTIAL_NONCE:nonce}},(err,stdout)=>err?reject(err):resolve(stdout));child.stdin.end('protocol=https\nhost=github.com\npath=org/project.git\n\n')});assert(output.includes(`username=${identity.login}`));assert(output.includes(`password=${identity.token}`))}finally{await new Promise(r=>server.close(r))}
 }
 const fixture=resolve('bin/smoke-fixtures',`中文 repo ${Date.now()}`);await mkdir(fixture,{recursive:true});
 const git=(...args)=>execFileSync('git',args,{cwd:fixture,encoding:'utf8',windowsHide:true});
 git('init','-b','main');await writeFile(join(fixture,'readme.txt'),'initial\n');git('add','readme.txt');git('-c','user.name=Smoke','-c','user.email=smoke@example.invalid','-c','commit.gpgsign=false','commit','-m','Desktop smoke fixture');
 await writeFile(join(fixture,'readme.txt'),'updated\n');
 const id=await call('ImportCheckout',fixture);const imported=await call('Snapshot');assert(imported.checkouts.some(c=>c.id===id));
 const status=await call('GitStatus',id);assert.equal(status.branch,'main');assert.equal(status.files.length,1);
 const diff=await call('GitDiff',id,'readme.txt',false);assert(diff.includes('+updated'));
 await call('StageFile',id,'readme.txt',true);assert.equal((await call('GitStatus',id)).files[0].index,'M');
 await call('StageFile',id,'readme.txt',false);
 const taskID=await call('SwitchBranch',id,'smoke-branch',true);
 let task;for(let i=0;i<50;i++){task=(await call('Snapshot')).tasks.find(t=>t.id===taskID);if(['succeeded','failed','cancelled'].includes(task?.state))break;await new Promise(r=>setTimeout(r,100))}assert.equal(task?.state,'succeeded');
 assert.equal((await call('GitStatus',id)).branch,'smoke-branch');
 // Verify the real UI receives backend change events, selects a repository and renders Git tabs.
 await new Promise(r=>setTimeout(r,1000));
 await evaluate(`Array.from(document.querySelectorAll('.repository-row')).find(e=>e.textContent.includes(${JSON.stringify(fixture.split(/[\\/]/).pop())})).click()`);
 await new Promise(r=>setTimeout(r,500));assert((await evaluate(`document.querySelector('.detail-pane').textContent`)).includes('smoke-branch'));
 await evaluate(`document.querySelectorAll('[role="tab"]')[1].click()`);await new Promise(r=>setTimeout(r,300));assert((await evaluate(`document.querySelector('.detail-pane').textContent`)).includes('readme.txt'));
 const history=await call('GitHistory',id);assert.equal(history[0].author,'Smoke');
 await call('SaveGroup',{id:'',name:'Smoke test',members:[id]});
 const picture=await send('Page.captureScreenshot',{format:'png'});await writeFile(resolve('bin/desktop-smoke.png'),Buffer.from(picture.data,'base64'));
 await evaluate(`document.querySelectorAll('[role="tab"]')[0].click()`);
 await evaluate(`Array.from(document.querySelectorAll('.detail-pane button')).find(b=>b.textContent==='移出管理').click()`);
 assert((await evaluate(`document.querySelector('dialog[open]').textContent`)).includes('不会删除文件、目录或 Git 提交'));
 await evaluate(`Array.from(document.querySelectorAll('dialog[open] button')).find(b=>b.textContent==='取消').click()`);
 assert((await call('Snapshot')).checkouts.some(c=>c.id===id),'Cancelling forget removed metadata');
 await evaluate(`Array.from(document.querySelectorAll('.detail-pane button')).find(b=>b.textContent==='移出管理').click()`);
 await evaluate(`Array.from(document.querySelectorAll('dialog[open] button')).find(b=>b.textContent==='移出管理').click()`);
 for(let i=0;i<50;i++){if(!(await call('Snapshot')).checkouts.some(c=>c.id===id))break;await new Promise(r=>setTimeout(r,50))}
 assert(!(await call('Snapshot')).checkouts.some(c=>c.id===id),'Forget did not remove metadata');
 assert.equal(await readFile(join(fixture,'readme.txt'),'utf8'),'updated\n');
 assert((await readFile(join(fixture,'.git/HEAD'),'utf8')).includes('smoke-branch'));
 assert.notEqual(await call('ImportCheckout',fixture),id,'Reimport did not create a fresh record');
 console.log('PASS: native WebView → Wails → SQLite → real Git; two-account credential helper, import, diff, stage, branch tasks, UI tabs, confirmed forget and file preservation');
}finally{ws.close()}
