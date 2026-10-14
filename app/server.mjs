import http from 'node:http';
import {startLoginMonitor} from './login-monitor.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {spawn} from 'node:child_process';
import {validateTelegramAttachment,openTelegramFile,TELEGRAM_CLOUD_LIMIT} from './telegram-files.mjs';
import {downloadOptions, downloadError, codecFallback} from './quality.mjs';
import {availableFilename,alreadyPublished,publishFile} from './naming.mjs';

const cfg=JSON.parse(fs.readFileSync(process.env.QUEUE_CONFIG||'/run/queue/config.json','utf8'));
const stateDir=cfg.stateDir||'/state', dbFile=path.join(stateDir,'jobs.json');
let categories=cfg.categories;
let roots=Object.fromEntries(categories.map(c=>[c.id,c.path]));
let reserve=cfg.reserveBytes??20*1024**3, maxFile=cfg.maxFileBytes??50*1024**3;
const loginMonitor=startLoginMonitor({stateDir});
const activeStates=new Set(['queued','resolving','downloading','checking']);
let jobs=fs.existsSync(dbFile)?JSON.parse(fs.readFileSync(dbFile,'utf8')):[];
let worker=null, stopping=false;
const sessions=new Map(), attempts=new Map();
const now=()=>new Date().toISOString();
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function persist(){
 const tmp=dbFile+'.new';fs.writeFileSync(tmp,JSON.stringify(jobs),{mode:0o600});
 const fd=fs.openSync(tmp,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(tmp,dbFile);
}
function storage(category){
 const item=categories.find(c=>c.id===category&&c.enabled!==false);if(!item?.ready)throw fail('该分类未就绪，请在管理后台确认存储路径');const root=roots[category];if(!root)throw fail('无效的保存分类');
 if(fs.readFileSync(path.join(root,'.cobalt-volume'),'utf8').trim()!==item.volumeId)throw fail('媒体盘不可用，请检查挂载');
 const stat=fs.statfsSync(root);
 if(item.fsType && Number(stat.type)!==item.fsType)throw fail('媒体盘挂载类型不符，已停止写入');
 if(stat.bavail*stat.bsize<reserve)throw fail('媒体盘剩余空间不足，保留至少 20 GiB');
 const staging=path.join(root,'.cobalt-partials');
 fs.mkdirSync(staging,{recursive:true,mode:0o700});
 return {root,staging,free:stat.bavail*stat.bsize};
}
function inputUrl(raw){
 let u;try{u=new URL(raw);}catch{throw fail('请粘贴有效的视频网页链接');}
 if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.href.length>3000)throw fail('链接格式不支持');
 const h=u.hostname.toLowerCase();
 if(h==='localhost'||!h.includes('.')||h.endsWith('.local')||h.endsWith('.internal')||h.includes(':')||/^\d+\.\d+\.\d+\.\d+$/.test(h))throw fail('请使用平台视频链接，不能填写本机或内网地址');
 u.hash='';return u.href;
}
function internalTunnel(raw){
 const u=new URL(raw), expected=new URL(cfg.apiPublic);
 if(u.origin!==expected.origin||u.pathname!==expected.pathname.replace(/\/$/,'')+'/tunnel'||!u.search)throw fail('解析结果不是本机 Cobalt 下载通道，已拒绝');
 return new URL('/tunnel'+u.search,cfg.apiInternal).href;
}
function publicJob(j){
 return {...Object.fromEntries(Object.entries(j).filter(([k])=>!['target','partial','cancelRequested','telegramSource','publishing'].includes(k))),categoryName:j.categoryName||categories.find(c=>c.id===j.category)?.name||j.category,private:j.private??categories.find(c=>c.id===j.category)?.private??false};
}
function update(j,values){Object.assign(j,values,{updatedAt:now()});persist();}
function removePartial(j){if(j.partial){try{fs.unlinkSync(j.partial);}catch(e){if(e.code!=='ENOENT')throw e;}}}
function verifyMedia(file,signal){
 if(!cfg.ffmpeg)return Promise.resolve();
 return new Promise((resolve,reject)=>{
  const p=spawn(cfg.ffmpeg,['-nostdin','-v','error','-xerror','-i',file,'-t','1','-map','0:v?','-map','0:a?','-c','copy','-f','null','-'],{stdio:['ignore','ignore','pipe'],signal});
  let error='';p.stderr.on('data',b=>{error=(error+b.toString()).slice(-1000);});
  const timer=setTimeout(()=>p.kill('SIGKILL'),30000);
  p.on('error',e=>{clearTimeout(timer);reject(e);});
  p.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(fail('媒体文件检查失败，请重试下载'));});
 });
}
async function download(j,controller){
 const {root,staging}=storage(j.category);
 if(alreadyPublished(j)){removePartial(j);update(j,{state:'completed',error:null});return;}
 removePartial(j);
 update(j,{state:'resolving',bytes:0,total:null,error:null,attempts:(j.attempts||0)+1});
 let telegramFile;
 try{
 let result,remote;
 if(j.sourceType==='telegram'){
  const source=validateTelegramAttachment(j.telegramSource,cfg.telegramFiles);
  if(source.size>maxFile||storage(j.category).free-(source.size||0)*(cfg.telegramFiles?.local?2:1)<reserve)throw fail('文件过大或磁盘空间不足，无法保留下载缓存与成品');
  if(cfg.telegramFiles?.local){if(!source.size)throw fail('大文件下载需要已知的文件大小，请重新转发原视频。');update(j,{total:source.size,stage:'Telegram 正在下载到缓存，完成后入库'});}
  telegramFile=await openTelegramFile(j.telegramSource,{...cfg.telegramFiles,signal:controller.signal});
  result={filename:source.filename,metadata:{title:source.title},mediaInfo:{resolution:source.width&&source.height?`${source.width}×${source.height}`:null,qualityLabel:'Telegram 提供的文件'}};
 }else{
 const resolve=options=>fetch(cfg.apiInternal,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(options),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(90000)])});
 const options=downloadOptions(j);
 let response=await resolve(options);result=await response.json();
 const fallback=codecFallback(options,result);
 if(fallback){response=await resolve(fallback);result=await response.json();}
 if(!response.ok||result.status==='error')throw fail(downloadError(result.error?.code||response.status));
 if(result.status==='picker')throw fail('此链接包含多张图片或多个媒体，请在原 Cobalt 页面选择单项；下载队列目前接收单个视频');
 if(result.status!=='tunnel')throw fail('此资源未生成单个视频通道，请使用原 Cobalt 页面下载');
 remote=internalTunnel(result.url);
 }
 const original=String(result.filename||'video.mp4'), ext=path.extname(original).toLowerCase();
 if(!['.mp4','.mkv','.webm','.mov','.m4v','.avi','.ts','.m4a','.mp3','.ogg','.opus','.wav'].includes(ext))throw fail('该文件不是支持入库的视频或音频格式');
 const metadata=result.metadata&&typeof result.metadata==='object'?result.metadata:{};
 const filename=availableFilename(root,original,metadata,j.id);
 j.metadata=metadata;j.originalFilename=original;j.mediaInfo=result.mediaInfo||null;
 j.target=path.join(root,filename);j.partial=path.join(staging,j.id+'.part');
 update(j,{state:'downloading',filename,stage:null});
 const headerTimer=setTimeout(()=>controller.abort(fail('下载连接超过 90 秒未响应，请重试')),90000);
 let stream;
 try{stream=telegramFile?.response||await fetch(remote,{redirect:'error',signal:controller.signal});}finally{clearTimeout(headerTimer);}
 if(!stream.ok||!stream.body)throw fail('下载连接失败：HTTP '+stream.status);
 const type=stream.headers.get('content-type')||'';
 if(type.includes('json')||type.includes('text/html')){await stream.body.cancel();throw fail('上游返回了错误信息，未保存为视频');}
 const total=Number(stream.headers.get('content-length'))||telegramFile?.size||null;
 if(total&&(total>maxFile||(telegramFile&&!telegramFile.local&&total>TELEGRAM_CLOUD_LIMIT)||storage(j.category).free-total<reserve)){await stream.body.cancel();throw fail('文件超过 50 GiB 或媒体盘可用空间不足');}
 update(j,{total});
 let lastChunk=Date.now(),lastCheck=0,lastPersist=Date.now();
 const watchdog=setInterval(()=>{if(Date.now()-lastChunk>120000)controller.abort(fail('下载超过两分钟没有数据，请重试'));},10000);
 const meter=new Transform({transform(chunk,encoding,cb){
  try{
   lastChunk=Date.now();j.bytes+=chunk.length;
   if(telegramFile&&!telegramFile.local&&j.bytes>TELEGRAM_CLOUD_LIMIT)throw fail('视频超过 Telegram 官方接口的 20 MB 限制');
   if(j.bytes>maxFile)throw fail('单个文件超过 50 GiB 限制');
   if(j.bytes-lastCheck>16*1024**2){storage(j.category);lastCheck=j.bytes;}
   if(Date.now()-lastPersist>15000){persist();lastPersist=Date.now();}
   cb(null,chunk);
  }catch(e){cb(e);}
 }});
 try{await pipeline(stream.body,meter,fs.createWriteStream(j.partial,{flags:'wx',mode:0o600}),{signal:controller.signal});}
 finally{clearInterval(watchdog);}
 if(!j.bytes||(total&&j.bytes!==total)||(telegramFile?.size&&j.bytes!==telegramFile.size))throw fail('文件未下载完整，请重试');
 update(j,{state:'checking'});
 await verifyMedia(j.partial,controller.signal);
 if(controller.signal.aborted)throw fail('任务已取消');
 storage(j.category);
 const fd=fs.openSync(j.partial,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 // Media watchers see only the finished filename. No copy across disks.
 fs.chmodSync(j.partial,0o644);
 publishFile(j,root,persist);
 update(j,{state:'completed',finishedAt:now(),error:null});
 }finally{await telegramFile?.close();}
}
async function kick(){
 if(worker||stopping)return;
 const j=jobs.find(x=>x.state==='queued');if(!j)return;
 const controller=new AbortController();worker={id:j.id,controller};
 try{await download(j,controller);}
 catch(e){
  try{removePartial(j);}catch{}
  const safeError=j.sourceType==='telegram'&&!/^[\u3400-\u9fff]/.test(e.message||'')?'Telegram 文件下载失败，请检查代理后重试。':e.message;
  update(j,{state:j.cancelRequested?'cancelled':stopping?'queued':'failed',error:j.cancelRequested?null:stopping?'服务重启后重新下载':controller.signal.reason?.message||safeError||'下载失败'});
 }
 finally{worker=null;if(!stopping)setTimeout(kick,100);}
}
for(const j of jobs){if(['resolving','downloading','checking'].includes(j.state))j.state='queued';}
persist();
function session(req){
 const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('cobalt_queue='))?.slice(13);
 const s=sessions.get(token);if(!s||s.expires<Date.now()){if(token)sessions.delete(token);return null;}return s;
}
function json(res,status,data,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(data));}
async function body(req){
 let s='';for await(const b of req){s+=b;if(s.length>12000)throw fail('请求过大',413);}
 try{return JSON.parse(s||'{}');}catch{throw fail('无效请求');}
}
function checkMutation(req){
 if(!String(req.headers['content-type']||'').startsWith('application/json'))throw fail('必须提交 JSON',415);
 const origin=req.headers.origin;
 if(origin){let u;try{u=new URL(origin);}catch{throw fail('无效来源',403);}if(u.host!==req.headers.host)throw fail('请求来源不匹配',403);}
 if(req.headers['sec-fetch-site']==='cross-site')throw fail('不允许跨站操作',403);
}
const server=http.createServer(async(req,res)=>{
 try{
  const pathname=new URL(req.url,'http://local').pathname;
  if(pathname==='/healthz')return json(res,200,{ok:true});
  if(req.method==='POST')checkMutation(req);
  if(pathname==='/nas/api/login'&&req.method==='POST'){
   const key=req.headers['x-real-ip']||req.socket.remoteAddress;
   let bucket=attempts.get(key);if(!bucket||bucket.until<Date.now()){bucket={n:0,until:Date.now()+600000};attempts.set(key,bucket);}
   if(bucket.n>=10)throw fail('尝试过多，请十分钟后重试',429);
   const data=await body(req);bucket.n++;
   const username=String(data.username||''), user=cfg.users[username];
   const salt=user?.salt||'0000000000000000';
   const hash=await new Promise((resolve,reject)=>crypto.scrypt(String(data.password||''),salt,32,(e,k)=>e?reject(e):resolve(k)));
   if(!user||!crypto.timingSafeEqual(hash,Buffer.from(user.hash,'hex')))throw fail('账号或密码不正确',401);
   bucket.n=0;const token=crypto.randomBytes(32).toString('hex'),csrf=crypto.randomBytes(24).toString('hex');
   sessions.set(token,{username,private:!!user.private,csrf,expires:Date.now()+7*86400000});
   const secure=req.headers['x-forwarded-proto']==='https'?'; Secure':'';
   return json(res,200,{ok:true},{'Set-Cookie':`cobalt_queue=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure}`});
  }
  const user=session(req);if(!user)throw fail('请先登录',401);
  if(pathname==='/nas/api/check'&&req.method==='GET')return json(res,200,{ok:true});
  if(pathname==='/nas/api/platform-status'&&req.method==='GET')return json(res,200,loginMonitor.snapshot());
  if(req.method==='POST'&&req.headers['x-csrf-token']!==user.csrf)throw fail('登录已失效，请刷新页面',403);
  if(pathname==='/nas/api/me'&&req.method==='GET')return json(res,200,{username:user.username,private:user.private,csrf:user.csrf});
  if(pathname==='/nas/api/logout'&&req.method==='POST'){
   for(const [key,value]of sessions)if(value===user)sessions.delete(key);
   return json(res,200,{ok:true},{'Set-Cookie':'cobalt_queue=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});
  }
  if(pathname==='/nas/api/jobs'&&req.method==='GET'){
   let disk;try{disk={ok:true,free:storage(cfg.defaultCategory).free};}catch(e){disk={ok:false,error:e.message};}
   return json(res,200,{disk,jobs:jobs.filter(j=>j.owner===user.username).map(publicJob).reverse()});
  }
  if(pathname==='/nas/api/jobs'&&req.method==='POST'){
   const data=await body(req), category=data.category||cfg.defaultCategory;
   if(categories.find(c=>c.id===category)?.private&&!user.private)throw fail('无权使用该分类',403);
   storage(category);
   const source=data.source?validateTelegramAttachment(data.source,cfg.telegramFiles):null;
   if(source){if(!cfg.telegramFiles?.token)throw fail('Telegram Bot 尚未启用');source.botId=cfg.telegramFiles.token.split(':')[0];}
   const url=source?'https://t.me/':inputUrl(data.url),quality=source?'original':String(data.quality||'1080');
   if(!source&&!['360','480','720','1080','1440','2160','max'].includes(quality))throw fail('不支持的清晰度');
   const requestId=typeof data.requestId==='string'?data.requestId.slice(0,120):null;
   const existing=jobs.find(j=>j.owner===user.username&&((requestId&&j.requestId===requestId)||((source?j.sourceType==='telegram'&&j.telegramSource?.uniqueId===source.uniqueId&&j.telegramSource?.botId===source.botId:j.sourceType!=='telegram'&&j.url===url)&&j.category===category&&j.quality===quality&&(activeStates.has(j.state)||j.state==='completed'))));
   if(existing)return json(res,200,{job:publicJob(existing),duplicate:true});
   if(jobs.filter(j=>activeStates.has(j.state)).length>=50)throw fail('队列已满，请等待现有任务完成',429);
   const j={id:crypto.randomUUID(),owner:user.username,requestId,url,quality,...(source?{sourceType:'telegram',telegramSource:source,metadata:{title:source.title},filename:source.filename}:{}),category,categoryName:categories.find(c=>c.id===category).name,private:!!categories.find(c=>c.id===category).private,state:'queued',bytes:0,total:null,createdAt:now(),updatedAt:now(),attempts:0};
   jobs.push(j);persist();setTimeout(kick,0);return json(res,201,{job:publicJob(j)});
  }
  const match=pathname.match(/^\/nas\/api\/jobs\/([a-f0-9-]{36})\/(cancel|retry)$/);
  if(match&&req.method==='POST'){
   const j=jobs.find(j=>j.id===match[1]&&j.owner===user.username);if(!j)throw fail('找不到任务',404);
   if(match[2]==='cancel'){
    if(activeStates.has(j.state)){
     if(worker?.id===j.id){j.cancelRequested=true;worker.controller.abort(fail('已取消'));}
     else update(j,{state:'cancelled',error:null});
    }
   }else{
    if(!['failed','cancelled'].includes(j.state))throw fail('只能重试失败或取消的任务');
    storage(j.category);j.cancelRequested=false;update(j,{state:'queued',bytes:0,total:null,error:null});setTimeout(kick,0);
   }
   return json(res,200,{job:publicJob(j)});
  }
  throw fail('找不到页面',404);
 }catch(e){json(res,e.status||500,{error:e.status?e.message:'服务暂时不可用，请检查磁盘后重试'});}
});
server.requestTimeout=15000;server.headersTimeout=10000;
server.listen(Number(process.env.PORT||9080),'0.0.0.0',()=>{console.log('Download queue ready');kick();});
setInterval(()=>{for(const[k,v]of sessions)if(v.expires<Date.now())sessions.delete(k);for(const[k,v]of attempts)if(v.until<Date.now())attempts.delete(k);},60000).unref();
async function stop(){if(stopping)return;stopping=true;loginMonitor.stop();server.close();worker?.controller.abort(fail('服务重启'));setTimeout(()=>{persist();process.exit(0);},1500).unref();}
process.on('SIGHUP',()=>{try{const next=JSON.parse(fs.readFileSync(process.env.QUEUE_CONFIG||'/run/queue/config.json','utf8'));if(next.stateDir!==cfg.stateDir||!Array.isArray(next.categories))throw Error();Object.assign(cfg,next);categories=cfg.categories;roots=Object.fromEntries(categories.map(c=>[c.id,c.path]));reserve=cfg.reserveBytes??20*1024**3;maxFile=cfg.maxFileBytes??50*1024**3;}catch{console.error('Queue configuration reload rejected');}});
process.on('SIGTERM',stop);process.on('SIGINT',stop);
