import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {telegramAttachment,openTelegramFile,TELEGRAM_CLOUD_LIMIT} from '../app/telegram-files.mjs';
import {openCachedTelegramFile} from '../app/telegram-cache.mjs';
import {migrateTelegramMode} from '../app/telegram-mode.mjs';
import {createTelegramTransport} from '../app/telegram-transport.mjs';
import {defaults,updateSettings,publicSettings} from '../manager/core.mjs';
const token='123456789:abcdefghijklmnopqrstuvwxyz';
test('local mode downloads >20MB through the private API and removes only its completed cache',async t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mdh-local-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'files',token,'videos');fs.mkdirSync(dir,{recursive:true});
 const file=path.join(dir,'large.mp4'),size=TELEGRAM_CLOUD_LIMIT+1024;const fd=fs.openSync(file,'w');fs.ftruncateSync(fd,size);fs.closeSync(fd);
 const source=telegramAttachment({video:{file_id:'large_file_123',file_unique_id:'large_unique',file_size:size}},{local:true});
 let calls=0;const result=await openTelegramFile(source,{token,local:true,cacheRoot:root,proxy:'http://never-used',signal:new AbortController().signal,fetchImpl:async(url,o)=>{
  calls++;assert.equal(url,`http://telegram-api:8081/bot${token}/getFile`);assert.equal(JSON.parse(o.body)._expected_size,size);
  return Response.json({ok:true,result:{file_path:file,file_size:size}});
 }});
 let received=0;for await(const chunk of result.response.body)received+=chunk.length;
 assert.equal(received,size);assert.equal(result.local,true);assert.equal(calls,1);await result.close();await result.close();assert(!fs.existsSync(file));
});
test('local cache rejects symlinks, traversal, other bots and hardlinks without deleting their files',t=>{
 const raw=fs.mkdtempSync(path.join(os.tmpdir(),'mdh-safe-')),root=fs.realpathSync(raw);t.after(()=>fs.rmSync(raw,{recursive:true,force:true}));
 const dir=path.join(root,'files',token);fs.mkdirSync(dir,{recursive:true});
 const outside=path.join(root,'secret.mp4');fs.writeFileSync(outside,'keep');const sym=path.join(dir,'link.mp4');fs.symlinkSync(outside,sym);
 const hard=path.join(dir,'hard.mp4');fs.linkSync(outside,hard);
 for(const file of [outside,sym,hard,path.join(dir,'x')+'/../secret.mp4'])assert.throws(()=>openCachedTelegramFile(file,root,token));
 assert.equal(fs.readFileSync(outside,'utf8'),'keep');
});
test('switch logs out old endpoint once, retains migration on restart and refuses unknown failures',async()=>{
 let previous=null;const calls=[];
 const run=local=>migrateTelegramMode({local,botId:'123',previous,request:async(mode,method)=>calls.push([mode,method]),save:next=>{previous=next;}});
 await run(true);await run(true);assert.deepEqual(calls,[['cloud','logOut']]);await run(false);assert.deepEqual(calls.at(-1),['local','logOut']);
 let saved=false;await assert.rejects(migrateTelegramMode({local:true,botId:'123',request:async()=>{throw Error('network');},save:()=>{saved=true;}}));assert(!saved);
 await migrateTelegramMode({local:true,botId:'123',request:async()=>{throw Object.assign(Error(),{code:401});},save:()=>{saved=true;}});assert(saved);
});
test('local transport never builds a proxy pool or leaks credentials in API errors',async()=>{
 const t=createTelegramTransport({token,local:true,makeProxy:()=>{throw Error('unexpected proxy');},signal:new AbortController().signal,fetchImpl:async url=>{assert(url.startsWith('http://telegram-api:8081/'));return Response.json({ok:false,error_code:429,description:token,parameters:{retry_after:3}},{status:429});}});
 await assert.rejects(t.request('getMe'),e=>e.code===429&&e.retryAfter===3&&!e.message.includes(token));await t.close();
});
test('admin validates application credentials, never returns API hash, and preserves blank secrets',()=>{
 const d=defaults();assert.throws(()=>updateSettings(d,{telegram:{local:true}}),/API ID/);
 const hash='f'.repeat(32);const s=updateSettings(d,{telegram:{local:true,apiId:'12345',apiHash:hash}});
 assert.equal(publicSettings(s).telegram.apiHashConfigured,true);assert(!JSON.stringify(publicSettings(s)).includes(hash));
 assert.equal(updateSettings(s,{telegram:{apiHash:''}}).telegram.apiHash,hash);
 assert.throws(()=>updateSettings(s,{telegram:{apiId:'9999999999'}}),/API ID/);
});
