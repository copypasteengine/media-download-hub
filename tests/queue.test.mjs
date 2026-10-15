import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

test('persistent queue, isolation, cancel, broken stream and safe paths',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cobalt-queue-test-'));
 for(const x of ['normal','private','state'])fs.mkdirSync(path.join(dir,x));
 for(const x of ['normal','private'])fs.writeFileSync(path.join(dir,x,'.cobalt-volume'),'test-volume');
 const payload=Buffer.alloc(1024*64,7);let requests=0;
 const mock=http.createServer(async(req,res)=>{
  if(req.method==='POST'){
   let raw='';for await(const b of req)raw+=b;const d=JSON.parse(raw);assert.equal(d.alwaysProxy,true);assert.equal(d.localProcessing,'disabled');requests++;
   const id=new URL(d.url).pathname.slice(1);res.setHeader('Content-Type','application/json');
   const streamId=id==='empty-vp9'?(d.youtubeVideoCodec==='h264'?'recovered':'empty'):id==='interrupted-vp9'?(d.youtubeVideoCodec==='h264'?'recovered':'mux-broken'):id==='always-empty'?'empty':id;
   return res.end(JSON.stringify({status:'tunnel',filename:'../../unsafe.mp4',mediaInfo:{codec:d.youtubeVideoCodec},metadata:id==='one'?{title:'采集到的视频标题',artist:'作者'}:undefined,url:(id==='ssrf'?'http://127.0.0.1:1':mockURL)+'/tunnel?id='+streamId}));
  }
  const id=new URL(req.url,'http://test').searchParams.get('id');
  if(id==='empty'){res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':'0'});return res.end();}
  if(id==='mux-broken'){res.writeHead(200,{'Content-Type':'video/mp4','X-Cobalt-Verified-Mux':'1'});res.write(payload);return setTimeout(()=>res.destroy(),50);}
  res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':id==='broken'?payload.length*2:payload.length});
  if(id==='broken'){res.write(payload);return setTimeout(()=>res.destroy(),50);}
  if(id.startsWith('slow')){let n=0;const timer=setInterval(()=>{res.write(payload.subarray(n,n+1024));n+=1024;if(n>=payload.length){clearInterval(timer);res.end();}},80);res.on('close',()=>clearInterval(timer));return;}
  res.end(payload);
 });
 await new Promise(r=>mock.listen(0,'127.0.0.1',r));const mockURL='http://127.0.0.1:'+mock.address().port;
 const portServer=http.createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));const port=portServer.address().port;await new Promise(r=>portServer.close(r));
 const cfg={categories:['normal','private'].map(id=>({id,name:id,path:path.join(dir,id),private:id==='private',ready:true,enabled:true,volumeId:'test-volume'})),defaultCategory:'normal',volumeId:'test-volume',stateDir:path.join(dir,'state'),roots:{normal:path.join(dir,'normal'),private:path.join(dir,'private')},reserveBytes:0,apiInternal:mockURL,apiPublic:mockURL,users:{}};
 for(const name of ['xyl','r18']){const salt=crypto.randomBytes(8).toString('hex');cfg.users[name]={salt,hash:crypto.scryptSync('test-secret',salt,32).toString('hex'),private:name==='r18'};}
 fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify(cfg));let proc;
 async function start(){proc=spawn(process.execPath,['app/server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,QUEUE_CONFIG:path.join(dir,'config.json'),PORT:String(port)},stdio:['ignore','pipe','pipe']});let log='';proc.stderr.on('data',b=>log+=b);for(let i=0;i<100;i++){try{if((await fetch(base+'/healthz')).ok)return;}catch{}await sleep(50);}throw Error(log||'server did not start');}
 async function stop(){if(proc?.exitCode===null){proc.kill('SIGTERM');await new Promise(r=>proc.on('exit',r));}}
 t.after(async()=>{await stop();await new Promise(r=>mock.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+port;
 async function call(route,method='GET',data,auth,extra={}){const r=await fetch(base+'/nas/api/'+route,{method,headers:{...(method==='POST'?{'Content-Type':'application/json'}:{}),...(auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrf||''}:{}),...extra},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 async function login(username){const r=await call('login','POST',{username,password:'test-secret'});assert.equal(r.status,200);const auth={cookie:r.cookie};auth.csrf=(await call('me','GET',undefined,auth)).data.csrf;return auth;}
 async function submit(id,auth,category='normal'){const r=await call('jobs','POST',{url:'https://example.com/'+id,category},auth);assert.ok([200,201].includes(r.status),JSON.stringify(r));return r.data;}
 async function until(id,state,auth){for(let i=0;i<240;i++){const d=(await call('jobs','GET',undefined,auth)).data;const j=d.jobs.find(x=>x.id===id);if(j?.state===state)return j;await sleep(50);}throw Error('task not '+state);}
 await start();assert.equal((await call('jobs')).status,401);
 let normal=await login('xyl'),priv=await login('r18');
 assert.equal((await call('jobs','POST',{url:'https://example.com/x',category:'private'},normal)).status,403);
 assert.equal((await call('jobs','POST',{url:'https://example.com/x'},normal,{Origin:'https://evil.example'})).status,403);
 assert.equal((await call('jobs','POST',{url:'http://127.0.0.1/admin'},normal)).status,400);
 const first=await submit('one',normal);const done=await until(first.job.id,'completed',normal);
 assert.equal(done.bytes,payload.length);assert.equal(done.filename,'采集到的视频标题 - 作者.mp4');assert.deepEqual(fs.readFileSync(path.join(dir,'normal',done.filename)),payload);
 assert.equal((await submit('one',normal)).duplicate,true);
 fs.unlinkSync(path.join(dir,'normal',done.filename));
 const replacement=await submit('one',normal);assert.notEqual(replacement.job.id,first.job.id);assert.equal(replacement.duplicate,undefined);await until(replacement.job.id,'completed',normal);
 const empty=await call('jobs','POST',{url:'https://youtu.be/empty-vp9',category:'normal',quality:'max'},normal);
 const fallbackDone=await until(empty.data.job.id,'completed',normal);assert.equal(fallbackDone.attempts,2);assert.equal(fallbackDone.mediaInfo.codec,'h264');assert.equal(fallbackDone.codecFallback.reason,'empty-stream');assert.equal(fallbackDone.bytes,payload.length);
 const always=await call('jobs','POST',{url:'https://youtu.be/always-empty',category:'normal',quality:'max'},normal);
 const stillEmpty=await until(always.data.job.id,'failed',normal);assert.equal(stillEmpty.attempts,2);assert.match(stillEmpty.error,/空文件/);
 const interrupted=await call('jobs','POST',{url:'https://youtu.be/interrupted-vp9',category:'normal',quality:'max'},normal);
 const retried=await until(interrupted.data.job.id,'completed',normal);assert.equal(retried.attempts,2);assert.equal(retried.codecFallback.reason,'interrupted-stream');assert.equal(retried.bytes,payload.length);
 const pj=await submit('private',priv,'private');await until(pj.job.id,'completed',priv);
 assert.ok(!(await call('jobs','GET',undefined,normal)).data.jobs.some(x=>x.category==='private'));
 assert.equal((await call('jobs/'+pj.job.id+'/cancel','POST',{},normal)).status,404);
 const slow=await submit('slow',normal);await until(slow.job.id,'downloading',normal);assert.equal((await call('jobs/'+slow.job.id+'/cancel','POST',{},normal)).status,200);await until(slow.job.id,'cancelled',normal);assert.equal(fs.readdirSync(path.join(dir,'normal','.cobalt-partials')).length,0);
 const broken=await submit('broken',normal);await until(broken.job.id,'failed',normal);assert.equal(fs.readdirSync(path.join(dir,'normal','.cobalt-partials')).length,0);
 const ssrf=await submit('ssrf',normal);await until(ssrf.job.id,'failed',normal);
 fs.writeFileSync(path.join(dir,'normal','.cobalt-volume'),'wrong-volume');assert.equal((await call('jobs','POST',{url:'https://example.com/mount'},normal)).status,400);fs.writeFileSync(path.join(dir,'normal','.cobalt-volume'),'test-volume');
 const slow2=await call('jobs/'+slow.job.id+'/retry','POST',{},normal);assert.equal(slow2.status,200);await until(slow.job.id,'downloading',normal);
 await stop();await start();normal=await login('xyl');priv=await login('r18');
 const recovered=await until(slow.job.id,'completed',normal);assert.ok(recovered.attempts>=2);assert.deepEqual(fs.readFileSync(path.join(dir,'normal',recovered.filename)),payload);
 assert.equal((await call('jobs','GET',undefined,normal)).data.jobs.find(x=>x.id===first.job.id).state,'completed');
 assert.equal((await call('jobs','GET',undefined,priv)).data.jobs.length,1);
 const hot=await submit('slow-hot',normal);await until(hot.job.id,'downloading',normal);
 const downloadsBefore=requests;
 fs.mkdirSync(path.join(dir,'courses'));fs.writeFileSync(path.join(dir,'courses','.cobalt-volume'),'courses-volume');
 cfg.categories[0].name='重命名分类';cfg.categories.push({id:'courses',name:'课程',path:path.join(dir,'courses'),enabled:true,ready:true,private:false,volumeId:'courses-volume'});
 fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify(cfg));proc.kill('SIGHUP');await sleep(100);
 const added=await submit('course',normal,'courses');
 const uninterrupted=await until(hot.job.id,'completed',normal);assert.equal(uninterrupted.attempts,1);
 const course=await until(added.job.id,'completed',normal);assert.equal(course.categoryName,'课程');assert.deepEqual(fs.readFileSync(path.join(dir,'courses',course.filename)),payload);assert.equal(requests,downloadsBefore+1);
 assert.ok(requests>=7);
 // Hot-reloaded permissions and credentials must apply to sessions already logged in.
 cfg.users.r18.private=false;fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify(cfg));proc.kill('SIGHUP');await sleep(100);
 assert.equal((await call('jobs','GET',undefined,priv)).data.jobs.length,0);
 assert.equal((await call('jobs/'+pj.job.id+'/retry','POST',{},priv)).status,404);
 cfg.users.r18.hash=crypto.scryptSync('changed-secret',cfg.users.r18.salt,32).toString('hex');fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify(cfg));proc.kill('SIGHUP');await sleep(100);
 assert.equal((await call('me','GET',undefined,priv)).status,401);
});
