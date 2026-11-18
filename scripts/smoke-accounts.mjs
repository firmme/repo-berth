import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { binaryDirectory } from './app-config.mjs';
assert.equal(process.platform, 'win32', 'Native account smoke targets Windows');
const root=resolve('bin/cli-smoke',String(Date.now()));
await mkdir(root,{recursive:true});
const child=spawn(join(binaryDirectory,'RepoBerth.exe'),['--devtools-port=9242'],{env:{...process.env,APPDATA:root,GH_CONFIG_DIR:join(root,'gh')},windowsHide:true,stdio:'ignore'});
let ws;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try {
 let target;
 for(let i=0;i<100;i++){try {target=(await(await fetch('http://127.0.0.1:9242/json/list')).json()).find(t=>t.url==='http://wails.localhost/');if(target)break;}catch{} await sleep(100);}
 assert(target,'No native WebView');ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
 let sequence=0;const pending=new Map();
 ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result)}};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>reject(new Error('CDP timeout')),10000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value};
 const click=async text=>evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw new Error('Missing button');b.click()})()`);
 for(let i=0;i<100;i++){if(await evaluate(`!!document.querySelector('.account-unit button')`))break;await sleep(100)}
 await evaluate(`document.querySelector('.account-unit button').click()`);await sleep(100);
 await click('添加 / 管理账号');await sleep(150);
 await click('通过 GitHub CLI 登录');await sleep(1000);
 assert((await evaluate(`document.querySelector('dialog:last-of-type').textContent`)).includes('通过官方 GitHub CLI 连接账号'));
 for(const width of [1440,1024]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await sleep(100);
  assert(await evaluate(`(()=>{const r=[...document.querySelectorAll('dialog[open]')].at(-1).getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight})()`),'CLI modal outside viewport');
  const image=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(root,`cli-${width}.png`),Buffer.from(image.data,'base64'));
 }
 await evaluate(`[...document.querySelectorAll('dialog[open]')].at(-1).querySelector('.modal-header button').click()`);await sleep(100);
 await click('使用 Token 添加账号');await sleep(100);
 assert.equal(await evaluate(`document.querySelector('input[type=password]')?.autocomplete`),'off');
 const picture=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(root,'token.png'),Buffer.from(picture.data,'base64'));
 await evaluate(`(async()=>{for(const r of performance.getEntriesByType('resource').filter(r=>r.name.endsWith('.js'))){const m=await import(r.name);const c=Object.values(m).find(v=>v&&typeof v.ByName==='function');if(c){window.__cliSmokeCall=c;return}}throw new Error('No Wails Call')})()`);
 assert(await evaluate(`window.__cliSmokeCall.ByName('repo-berth/internal/service.Service.ConnectToken','bad token',false,'').then(()=>false,e=>String(e).includes('INVALID_TOKEN'))`));
 assert.equal(await evaluate(`window.__cliSmokeCall.ByName('repo-berth/internal/service.Service.GitHubCLIAccounts').then(v=>Array.isArray(v))`),true);
 console.log('PASS: native account dialogs, 1440/1024 layout, token password field, Wails token validation and official CLI account discovery');
 console.log(root);
} finally {if(ws&&ws.readyState<2)ws.close();child.kill();}
