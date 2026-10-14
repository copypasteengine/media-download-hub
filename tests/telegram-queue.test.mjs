import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import http from 'node:http';import {spawn} from 'node:child_process';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('Telegram attachment queue saves bytes, isolates private categories, deduplicates and refreshes file references on retry',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mdh-tg-queue-'));for(const sub of ['media','private','state'])fs.mkdirSync(path.join(dir,sub));
 for(const sub of ['media','private'])fs.writeFileSync(path.join(dir,sub,'.cobalt-volume'),'test-volume');
 const token='123456789:abcdefghijklmnopqrstuvwxyz',payload='test-video-file-bytes';
 const salt='fixture-salt',credential={salt,hash:crypto.scryptSync('fixture-password',salt,32).toString('hex')};
 const cfg={stateDir:dir+'/state',categories:['media','private'].map(id=>({id,name:id,path:dir+'/'+id,volumeId:'test-volume',ready:true,enabled:true,private:id==='private'})),defaultCategory:'media',reserveBytes:0,maxFileBytes:1024**2,users:{owner:{...credential,private:true},ordinary:{...credential,private:false}},telegramFiles:{token},apiInternal:'http://127.0.0.1:1/',apiPublic:'http://cobalt:9000'};
 fs.writeFileSync(dir+'/config.json',JSON.stringify(cfg));
 // Mock only Telegram transport; real queue HTTP, auth, streaming, publication and state are exercised.
 fs.writeFileSync(dir+'/mock.mjs',`import fs from 'node:fs';const original=globalThis.fetch;
 globalThis.fetch=async(url,options={})=>{
  if(!String(url).startsWith('https://api.telegram.org/'))return original(url,options);
  if(String(url).endsWith('/getFile')){const d=JSON.parse(options.body);fs.appendFileSync(${JSON.stringify(dir+'/requests')},d.file_id+'\\n');return Response.json({ok:true,result:{file_path:'videos/'+d.file_id+'.mp4',file_size:${payload.length}}});}
  const broken=String(url).includes('broken');return new Response(broken?'short':${JSON.stringify(payload)},{headers:{'content-type':'video/mp4','content-length':String(${payload.length})}});
 };`);
 const sock=http.createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 let log='';const proc=spawn(process.execPath,['--import',dir+'/mock.mjs','app/server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:String(port),QUEUE_CONFIG:dir+'/config.json'},stdio:['ignore','pipe','pipe']});proc.stderr.on('data',b=>log+=b);
 t.after(async()=>{if(proc.exitCode===null){proc.kill();await new Promise(r=>proc.once('exit',r));}fs.rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+port;for(let i=0;i<100;i++){try{if((await fetch(base+'/healthz')).ok)break;}catch{}await sleep(40);}assert.equal(log,'');
 async function call(route,data,auth={}){const res=await fetch(base+'/nas/api/'+route,{method:data?'POST':'GET',headers:{Cookie:auth.cookie||'','X-CSRF-Token':auth.csrf||'','Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return{status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};}
 async function login(username){const r=await call('login',{username,password:'fixture-password'});assert.equal(r.status,200);const auth={cookie:r.cookie};auth.csrf=(await call('me',null,auth)).data.csrf;return auth;}
 const owner=await login('owner'),ordinary=await login('ordinary');
 const source={type:'telegram',fileId:'file_12345',uniqueId:'unique_12345',filename:'source.mp4',title:'转发视频的标题',size:payload.length,width:1920,height:1080};
 async function until(id,state){for(let i=0;i<100;i++){const r=await call('jobs',null,owner);const job=r.data.jobs.find(j=>j.id===id);if(job?.state===state)return job;await sleep(30);}throw Error('Did not reach '+state);}
 assert.equal((await call('jobs',{source,category:'private'},ordinary)).status,403);
 assert.equal((await call('jobs',{source:{...source,fileId:'../invalid'}},owner)).status,400);
 assert.equal((await call('jobs',{source:{...source,size:21*1024**2}},owner)).status,400);
 const submitted=await call('jobs',{source,category:'private',requestId:'tg:test:1'},owner);assert.equal(submitted.status,201);
 const job=await until(submitted.data.job.id,'completed');assert.equal(job.quality,'original');assert.equal(job.filename,'转发视频的标题.mp4');assert.equal(fs.readFileSync(dir+'/private/'+job.filename,'utf8'),payload);
 assert.equal(job.telegramSource,undefined);assert(!JSON.stringify(job).includes(source.fileId));assert(!fs.readFileSync(dir+'/state/jobs.json','utf8').includes(token));
 assert.equal((await call('jobs',{source,category:'private'},owner)).data.duplicate,true);
 assert.equal((await call('jobs',null,ordinary)).data.jobs.length,0);
 const broken=await call('jobs',{source:{...source,fileId:'broken_12345',uniqueId:'unique_broken'}},owner);assert.equal(broken.status,201);await until(broken.data.job.id,'failed');
 assert.equal(fs.readdirSync(dir+'/media/.cobalt-partials').length,0);
 await call('jobs/'+broken.data.job.id+'/retry',{},owner);await until(broken.data.job.id,'failed');
 assert.equal(fs.readFileSync(dir+'/requests','utf8').split('\n').filter(x=>x==='broken_12345').length,2);
});
