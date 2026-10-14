import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {atomic,read,defaults,passwordHash,verifyPassword,cookieInput,publicSettings,updateSettings,xrayConfig,encryptBackup,decryptBackup,platforms} from './core.mjs';
import {storageRoots,categoryPath,browseDirectory,createDirectory} from '../app/storage.mjs';
import {parseSubscription,fetchSubscription} from './proxy-import.mjs';
import {ensureCatalog,publicProxy,importCatalog,selectNode} from './proxy-catalog.mjs';
import {probeNode} from './proxy-probe.mjs';
import {createProxyController} from './proxy-controller.mjs';
import {runtimeRequire} from './dependencies.mjs';
import {checkBilibili,checkYouTube} from '../app/login-probes.mjs';
const config=process.env.CONFIG_DIR||'/config',state=process.env.STATE_ROOT||'/state',statusRoot=process.env.STATUS_ROOT||'/status';
for(const d of [config,config+'/platform-auth',state+'/queue',state+'/feishu',statusRoot])fs.mkdirSync(d,{recursive:true,mode:0o700});
if(!read(config+'/settings.json'))atomic(config+'/settings.json',defaults());
const initialSettings=read(config+'/settings.json');if(initialSettings.version<3){initialSettings.version=3;initialSettings.urlMode='auto';for(const c of initialSettings.categories)c.storageId=c.storageId||'main';atomic(config+'/settings.json',initialSettings);}
if(!read(config+'/cookies.json'))atomic(config+'/cookies.json',{});
const catalogSettings=read(config+'/settings.json');if(!catalogSettings.proxy.catalog){catalogSettings.proxy=ensureCatalog(catalogSettings.proxy);atomic(config+'/settings.json',catalogSettings);}
const roots=storageRoots();
const sessions=new Map(),attempts=new Map(),websockets=new Set();let restoring=false;
const error=(message,status=400)=>Object.assign(new Error(message),{status});
const readSettings=()=>read(config+'/settings.json');
function session(req){const id=(req.headers.cookie||'').match(/(?:^|;\s*)nmd_session=([a-f0-9]{64})(?:;|$)/)?.[1];const s=sessions.get(id);if(!s||s.expires<Date.now()){sessions.delete(id);return null;}return {...s,id};}
function json(res,data,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
async function body(req,limit=100000){let bytes=0,chunks=[];for await(const b of req){bytes+=b.length;if(bytes>limit)throw error('请求过大',413);chunks.push(b);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw error('JSON 格式错误');}}
function sameOrigin(req){if(req.headers['sec-fetch-site']==='cross-site')throw error('不允许跨站操作',403);const origin=req.headers.origin;if(origin){let u;try{u=new URL(origin);}catch{throw error('来源无效',403);}if(u.host!==req.headers.host)throw error('来源不匹配',403);}}
function issueSession(res){const id=crypto.randomBytes(32).toString('hex'),csrf=crypto.randomBytes(24).toString('hex');sessions.set(id,{csrf,expires:Date.now()+8*3600000});res.setHeader('Set-Cookie',`nmd_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);return csrf;}
async function probe(platform,cookie){if(!cookie)return {status:'unconfigured'};if(platform==='bilibili')return checkBilibili(cookie);const {Innertube,Log}=await import('/youtube-runtime/node_modules/youtubei.js/dist/src/platform/node.js');Log?.setLevel(0);const require=createRequire('/runtime/package.json'),{fetch:ufetch,ProxyAgent,Request}=require('undici');const proxy=new ProxyAgent('http://proxy:1080');try{return await checkYouTube(cookie,{Innertube,fetchImpl:(input,init)=>ufetch(new Request(typeof input==='string'?input:input instanceof URL?input:input.url,typeof input==='object'&&!(input instanceof URL)?input:undefined),{...init,dispatcher:proxy,redirect:'error',signal:AbortSignal.timeout(25000)})});}finally{await proxy.close();}}
async function saveCookie(platform,input){let cookie;try{cookie=cookieInput(platform,input);}catch(e){throw error(e.message);}const result=await probe(platform,cookie);if(result.status!=='valid')throw error(result.status==='invalid'?'登录已失效，原登录态未改动':'平台验证暂时失败，请检查代理或稍后重试；原登录态未改动',422);atomic(`${config}/platform-auth/${platform}.json`,{cookie,capturedAt:new Date().toISOString()});return {ok:true,status:'valid'};}
function validateCategory(c,confirm=false){const p=categoryPath(c,roots);if(confirm)fs.mkdirSync(p,{recursive:true,mode:0o755});if(!fs.existsSync(p))throw error('分类「'+c.name+'」目录不存在，请确认存储映射');const m=path.join(p,'.cobalt-volume');if(confirm){if(fs.existsSync(m)){const id=fs.readFileSync(m,'utf8').trim();if(!id||id.length>256)throw error('目录标识无效');c.volumeId=id;}else fs.writeFileSync(m,c.volumeId,{mode:0o600,flag:'wx'});c.fsType=Number(fs.statfsSync(p).type);c.ready=true;}if(!c.ready||!fs.existsSync(m)||fs.readFileSync(m,'utf8').trim()!==c.volumeId)throw error('分类「'+c.name+'」尚未确认或存储标识不符');const t=fs.statfsSync(p);if(c.fsType&&Number(t.type)!==c.fsType)throw error('分类「'+c.name+'」文件系统与确认时不符');fs.accessSync(p,fs.constants.W_OK);return {id:c.id,name:c.name,path:c.path,ready:true,free:t.bavail*t.bsize,total:t.blocks*t.bsize};}
function validateDisk(s,confirm=false){return s.categories.filter(c=>c.enabled).map(c=>validateCategory(c,confirm));}
function checkProxy(s){atomic('/tmp/check-xray.json',xrayConfig(s));try{const test=spawnSync('/usr/local/bin/xray',['run','-test','-config','/tmp/check-xray.json'],{timeout:10000,stdio:'ignore'});if(test.status!==0)throw error('代理配置未通过 Xray 校验，原配置保持不变');}finally{fs.rmSync('/tmp/check-xray.json',{force:true});}}
const proxyController=createProxyController({read:readSettings,save:s=>atomic(config+'/settings.json',s),probe:probeNode,validate:p=>checkProxy({proxy:p}),isDownloading:()=>read(state+'/queue/jobs.json',[]).some(j=>['resolving','downloading','checking'].includes(j.state)),isPaused:()=>restoring||fs.existsSync(config+'/maintenance')});
setInterval(()=>void proxyController.tick(),15000).unref();
function idleProxy(){if(proxyController.state().running)throw error('正在检测节点，请等待完成或先取消检测',409);}
async function queueRequest(route,method='GET',data){const s=readSettings(),r=await fetch('http://queue:9080/nas/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:s.queueUsername,password:s.queuePassword}),signal:AbortSignal.timeout(8000)});if(!r.ok)throw error('下载队列尚未就绪',503);const cookie=r.headers.get('set-cookie')?.split(';')[0];const me=await fetch('http://queue:9080/nas/api/me',{headers:{cookie},signal:AbortSignal.timeout(5000)}).then(r=>r.json());const out=await fetch('http://queue:9080/nas/api/'+route,{method,headers:{cookie,'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(10000)});const d=await out.json();if(!out.ok)throw error(d.error||'队列操作失败',out.status);return d;}
const stateFiles=['queue/jobs.json','queue/telegram.json','queue/telegram.json.api-mode.json','queue/platform-login-health.json','queue/bot-info.json','feishu/feishu.json'];
async function pause(){fs.writeFileSync(config+'/maintenance','maintenance',{mode:0o600});for(let i=0;i<30;i++){const busy=['queue','telegram','feishu'].some(n=>{const h=read(statusRoot+'/'+n+'.json');return h&&h.state!=='maintenance'&&Date.now()-Date.parse(h.updatedAt)<15000;});if(!busy)return;await new Promise(r=>setTimeout(r,500));}throw error('服务未能暂停，未执行备份/恢复',503);}
function unpause(){try{fs.unlinkSync(config+'/maintenance');}catch{}}
function snapshot(){return {version:3,createdAt:new Date().toISOString(),settings:readSettings(),queueUser:read(config+'/queue-user.json'),platforms:Object.fromEntries(platforms.map(p=>[p,read(config+'/platform-auth/'+p+'.json')])),states:Object.fromEntries(stateFiles.map(f=>[f,read(state+'/'+f)]))};}
async function browserCall(route,data){if(process.env.BROWSER_LOGIN_ENABLED!=='true')throw error('可选浏览器登录组件未启用，请使用 Cookie 导入',503);const r=await fetch('http://browser:6090/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data||{}),signal:AbortSignal.timeout(40000)});const d=await r.json();if(!r.ok)throw error(d.error||'浏览器服务暂不可用',502);return d;}
function browserProxy(req,res){const target='/'+req.url.slice('/browser/'.length);const p=http.request({hostname:'browser',port:6080,path:target,method:'GET'},r=>{res.writeHead(r.statusCode,{...r.headers,'cache-control':'no-store','x-frame-options':'SAMEORIGIN'});r.pipe(res);});p.on('error',()=>{if(!res.headersSent)json(res,{error:'临时浏览器尚未启动或已自动关闭'},503);else res.end();});p.end();}
const server=http.createServer(async(req,res)=>{try{
 const pathname=new URL(req.url,'http://local').pathname;
 if(pathname==='/healthz')return json(res,{ok:true});
 if(req.method==='POST'){sameOrigin(req);if(!String(req.headers['content-type']||'').startsWith('application/json'))throw error('需要 JSON 请求',415);}
 const admin=read(config+'/admin.json'),user=session(req);
 if(pathname==='/api/session')return json(res,{initialized:!!admin,loggedIn:!!user,csrf:user?.csrf,username:user?admin?.username:undefined});
 if(pathname==='/api/setup'&&req.method==='POST'){
  if(admin)throw error('已经初始化',409);const d=await body(req);if(!/^[\w@.-]{1,64}$/.test(d.username||''))throw error('用户名只能使用字母、数字和 @ . _ -');let cred;try{cred=passwordHash(d.password);}catch(e){throw error(e.message);}if(read(config+'/admin.json'))throw error('已完成初始化',409);atomic(config+'/admin.json',{username:d.username,...cred});const s=readSettings();atomic(config+'/queue-user.json',{...passwordHash(s.queuePassword),private:true});return json(res,{ok:true,csrf:issueSession(res)});
 }
 if(pathname==='/api/login'&&req.method==='POST'){
  const ip=req.socket.remoteAddress;let b=attempts.get(ip);if(!b||b.until<Date.now()){b={n:0,until:Date.now()+600000};attempts.set(ip,b);}if(b.n>=8)throw error('尝试过多，请十分钟后重试',429);b.n++;const d=await body(req);if(!admin||d.username!==admin.username||!verifyPassword(d.password,admin))throw error('用户名或密码不正确',401);b.n=0;return json(res,{ok:true,csrf:issueSession(res)});
 }
 if(pathname.startsWith('/api/')||pathname.startsWith('/browser/')){
  if(!user)throw error('请先登录',401);if(req.method==='POST'&&req.headers['x-csrf-token']!==user.csrf)throw error('页面已过期，请刷新',403);
  if(pathname.startsWith('/browser/')&&req.method==='GET'){if(process.env.BROWSER_LOGIN_ENABLED!=='true')throw error('浏览器登录组件未启用',503);return browserProxy(req,res);}
  if(restoring&&req.method==='POST')throw error('正在备份或恢复，请稍候',409);
  if(pathname==='/api/logout'&&req.method==='POST'){sessions.delete(user.id);for(const ws of websockets)if(ws.session===user.id)ws.socket.destroy();void browserCall('stop').catch(()=>{});res.setHeader('Set-Cookie','nmd_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,{ok:true});}
  if(pathname==='/api/password'&&req.method==='POST'){const d=await body(req);if(!verifyPassword(d.current,admin))throw error('当前密码错误',403);let cred;try{cred=passwordHash(d.password);}catch(e){throw error(e.message);}atomic(config+'/admin.json',{username:admin.username,...cred});sessions.clear();return json(res,{ok:true,csrf:issueSession(res)});}
  if(pathname==='/api/settings'&&req.method==='GET')return json(res,{...publicSettings(readSettings()),webPort:Number(process.env.WEB_PORT||9070)});
  if(pathname==='/api/settings'&&req.method==='POST'){
   const d=await body(req,3*1024**2),old=readSettings();if(d.proxy)throw error('请在节点列表中选择代理');let s;try{s=updateSettings(old,d);}catch(e){throw error(e.message);}
   if(d.proxy&&s.proxy.mode==='xray')checkProxy(s);
   const changedIds=old.categories.filter(c=>{const n=s.categories.find(n=>n.id===c.id);return !n||n.path!==c.path||(n.storageId||'main')!==(c.storageId||'main')||n.enabled!==c.enabled;}).map(c=>c.id);
   if(old.categories.some(c=>c.ready)){const jobs=read(state+'/queue/jobs.json',[]);if(jobs.some(j=>['queued','resolving','downloading','checking'].includes(j.state)&&changedIds.includes(j.category)))throw error('受影响分类有未完成任务，请完成或取消后再改路径、停用或删除',409);}
   for(const c of s.categories)categoryPath(c,roots);
   if(d.confirmStorage===true)validateDisk(s,true);
   const changedTelegramApi=!!s.telegram.local!==!!old.telegram.local||s.telegram.apiId!==old.telegram.apiId||s.telegram.apiHash!==old.telegram.apiHash;
   if(changedTelegramApi&&read(state+'/queue/jobs.json',[]).some(j=>j.sourceType==='telegram'&&['queued','resolving','downloading','checking'].includes(j.state)))throw error('请先完成或取消 Telegram 下载，再切换大文件服务',409);
   const changedBot=s.telegram.token!==old.telegram.token||s.feishu.appId!==old.feishu.appId;
   if(changedBot){restoring=true;try{await pause();if(s.telegram.token!==old.telegram.token){fs.rmSync(state+'/queue/bot-info.json',{force:true});atomic(state+'/queue/telegram.json',{offset:0,owner:null,quality:'1080',watches:{}});s.telegram.pairingCode=crypto.randomBytes(24).toString('base64url');}if(s.feishu.appId!==old.feishu.appId){atomic(state+'/feishu/feishu.json',{owner:null,quality:'1080',watches:{},inbox:[],seen:[]});s.feishu.pairingCode=crypto.randomBytes(24).toString('base64url');}atomic(config+'/settings.json',s);}finally{unpause();restoring=false;}}else atomic(config+'/settings.json',s);
   return json(res,{ok:true,settings:publicSettings(s)});
  }
  if(pathname==='/api/status'){
   const disks=readSettings().categories.filter(c=>c.enabled).map(c=>{try{return validateCategory(c);}catch(e){return {id:c.id,name:c.name,path:c.path,ready:false,error:e.message};}});const disk={ready:disks.length>0&&disks.every(c=>c.ready),categories:disks};
   const health=read(state+'/queue/platform-login-health.json',{});return json(res,{browserAvailable:process.env.BROWSER_LOGIN_ENABLED==='true',disk,services:Object.fromEntries(['api','proxy','queue','telegram','telegram-api','feishu'].map(n=>[n,read(statusRoot+'/'+n+'.json',{state:'starting'})])),platforms:Object.fromEntries(platforms.map(p=>{const h=health.platforms?.[p]||{};return [p,{configured:!!read(config+'/platform-auth/'+p+'.json')?.cookie,status:h.status||'unconfigured',checkedAt:h.checkedAt,capturedAt:read(config+'/platform-auth/'+p+'.json')?.capturedAt}];})),telegram:{bound:!!read(state+'/queue/telegram.json')?.owner,username:read(state+'/queue/bot-info.json')?.username},feishu:{bound:!!read(state+'/feishu/feishu.json')?.owner}});
  }
  if(pathname==='/api/storage/roots'&&req.method==='GET')return json(res,{roots:roots.map(r=>{try{const t=fs.statfsSync(r.path);return {id:r.id,name:r.name,available:true,free:t.bavail*t.bsize};}catch{return {id:r.id,name:r.name,available:false};}})});
  if(pathname==='/api/storage/browse'&&req.method==='GET'){const q=new URL(req.url,'http://local').searchParams;try{return json(res,browseDirectory(roots,q.get('storageId')||roots[0].id,q.get('path')||'.'));}catch(e){throw error(e.code?'无法读取此目录，请检查挂载和访问权限':e.message);}}
  if(pathname==='/api/storage/mkdir'&&req.method==='POST'){const d=await body(req);try{return json(res,createDirectory(roots,d.storageId,d.parent||'.',d.name));}catch(e){throw error(e.code?'无法创建目录，请检查磁盘和写入权限':e.message);}}
  if(pathname==='/api/proxy'&&req.method==='GET')return json(res,publicProxy(readSettings().proxy,proxyController.state()));
  if(pathname==='/api/proxy/import'&&req.method==='POST'){
   idleProxy();const d=await body(req,3*1024**2);let result;const original=ensureCatalog(readSettings().proxy),source=d.sourceId?original.catalog.sources.find(v=>v.id===d.sourceId):null;if(d.sourceId&&!source)throw error('订阅已不存在');
   const url=source?.url||d.url||'';try{result=parseSubscription(url?await fetchSubscription(url):d.content);}catch(e){throw error(e.message);}
   idleProxy();const s=readSettings();try{s.proxy=importCatalog(s.proxy,result,{url,name:d.name,sourceId:d.sourceId});}catch(e){throw error(e.message);}atomic(config+'/settings.json',s);
   if(s.proxy.selection==='auto')void proxyController.start({automatic:true}).catch(()=>{});
   return json(res,{imported:result.nodes.length,warnings:result.warnings,...publicProxy(s.proxy,proxyController.state())});
  }
  if(pathname==='/api/proxy/mode'&&req.method==='POST'){
   idleProxy();const d=await body(req),s=readSettings();s.proxy=ensureCatalog(s.proxy);
   if(d.mode==='direct'){s.proxy.mode='direct';s.proxy.selection='manual';s.proxy.autoStatus=null;s.proxy.autoPendingId=null;}
   else if(d.mode==='manual'){s.proxy.selection='manual';if(!s.proxy.config)throw error('请先选择一个节点');s.proxy.mode='xray';checkProxy(s);}
   else if(d.mode==='auto'){if(!s.proxy.catalog.nodes.length)throw error('请先导入节点');s.proxy.selection='auto';s.proxy.autoStatus='正在检测可用节点';}
   else throw error('连接模式无效');atomic(config+'/settings.json',s);if(d.mode==='auto')await proxyController.start({automatic:true});return json(res,{ok:true});
  }
  if(pathname==='/api/proxy/apply'&&req.method==='POST'){
   idleProxy();const d=await body(req),s=readSettings();try{s.proxy=selectNode(s.proxy,d.id);}catch(e){throw error(e.message);}s.proxy.autoStatus=null;s.proxy.autoPendingId=null;checkProxy(s);atomic(config+'/settings.json',s);return json(res,{ok:true});
  }
  if(pathname==='/api/proxy/test'&&req.method==='POST'){
   idleProxy();const d=await body(req);try{await proxyController.start({ids:d.id?[d.id]:undefined,automatic:!!d.auto&&readSettings().proxy.selection==='auto'});}catch(e){throw error(e.message);}return json(res,{ok:true});
  }
  if(pathname==='/api/proxy/cancel'&&req.method==='POST'){proxyController.cancel();return json(res,{ok:true});}
  if(pathname==='/api/proxy/remove'&&req.method==='POST'){
   idleProxy();const d=await body(req),s=readSettings();s.proxy=ensureCatalog(s.proxy);const affected=s.proxy.catalog.nodes.filter(n=>d.sourceId?n.sourceId===d.sourceId:n.id===d.id);if(affected.some(n=>n.id===s.proxy.selectedId)&&s.proxy.mode==='xray')throw error('该节点正在使用，请先切换其它节点或直连');
   s.proxy.catalog.nodes=s.proxy.catalog.nodes.filter(n=>!affected.some(a=>a.id===n.id));if(d.sourceId)s.proxy.catalog.sources=s.proxy.catalog.sources.filter(v=>v.id!==d.sourceId);if(affected.some(n=>n.id===s.proxy.selectedId)){delete s.proxy.config;delete s.proxy.selectedId;delete s.proxy.selectedName;}if(!s.proxy.catalog.nodes.length)s.proxy.selection='manual';atomic(config+'/settings.json',s);return json(res,{ok:true});
  }
  const pairRoute=pathname.match(/^\/api\/bots\/(telegram|feishu)\/pairing$/);
  if(pairRoute&&req.method==='GET'){
   const type=pairRoute[1],s=readSettings(),bound=!!read(state+(type==='telegram'?'/queue/telegram.json':'/feishu/feishu.json'))?.owner;
   const username=read(state+'/queue/bot-info.json')?.username;
   const link=type==='telegram'?(username?'https://t.me/'+username+(bound?'':'?start='+s.telegram.pairingCode):null):(s.feishu.appId?'https://applink.feishu.cn/client/bot/open?appId='+encodeURIComponent(s.feishu.appId):null);
   const qr=link?await runtimeRequire('qrcode').toDataURL(link,{width:240,margin:2}):null;
   return json(res,{bound,link,qr,command:bound?null:'/start '+s[type].pairingCode});
  }
  const botReset=pathname.match(/^\/api\/bots\/(telegram|feishu)\/unbind$/);
  if(botReset&&req.method==='POST'){const d=await body(req);if(d.confirm!==true)throw error('请确认解除原用户绑定');restoring=true;try{await pause();const type=botReset[1],s=readSettings();s[type].pairingCode=crypto.randomBytes(24).toString('base64url');atomic(state+(type==='telegram'?'/queue/telegram.json':'/feishu/feishu.json'),type==='telegram'?{offset:0,owner:null,quality:'1080',watches:{}}:{owner:null,quality:'1080',watches:{},inbox:[],seen:[]});atomic(config+'/settings.json',s);return json(res,{ok:true});}finally{unpause();restoring=false;}}
  const platformRoute=pathname.match(/^\/api\/platforms\/(bilibili|youtube)\/(import|check|remove)$/);
  if(platformRoute&&req.method==='POST'){const [,p,action]=platformRoute;if(action==='remove'){fs.rmSync(config+'/platform-auth/'+p+'.json',{force:true});return json(res,{ok:true});}if(action==='check'){const v=read(config+'/platform-auth/'+p+'.json');return json(res,await probe(p,v?.cookie));}const d=await body(req);return json(res,await saveCookie(p,d.cookie));}
  if(pathname==='/api/browser/start'&&req.method==='POST'){const d=await body(req);if(!platforms.includes(d.platform))throw error('不支持的平台');return json(res,await browserCall('start',{platform:d.platform}));}
  if(pathname==='/api/browser/finish'&&req.method==='POST'){const d=await browserCall('capture');if(!platforms.includes(d.platform))throw error('浏览器未选择平台');const out=await saveCookie(d.platform,JSON.stringify(d.cookies));await browserCall('stop');return json(res,out);}
  if(pathname==='/api/browser/stop'&&req.method==='POST')return json(res,await browserCall('stop'));
  if(pathname==='/api/jobs'&&req.method==='GET'){
   const query=new URL(req.url,'http://local').searchParams,filter=query.get('state')||'all',search=(query.get('search')||'').toLowerCase();
   const all=read(state+'/queue/jobs.json',[]),active=new Set(['queued','resolving','downloading','checking']);
   let jobs=all.filter(j=>(filter==='all'||filter==='active'&&active.has(j.state)||filter==='history'&&!active.has(j.state)||j.state===filter)&&(!search||[j.filename,j.metadata?.title,j.categoryName,j.url].some(v=>String(v||'').toLowerCase().includes(search)))).reverse();
   const total=jobs.length,page=Math.max(1,Math.min(Number(query.get('page'))||1,Math.max(1,Math.ceil(total/25)))),categories=readSettings().categories;
   jobs=jobs.slice((page-1)*25,page*25).map(({target,partial,cancelRequested,telegramSource,publishing,...j})=>({...j,categoryName:categories.find(c=>c.id===j.category)?.name||j.categoryName||j.category}));
   return json(res,{jobs,total,page,pages:Math.max(1,Math.ceil(total/25)),active:all.filter(j=>active.has(j.state)).length});
  }
  const job=pathname.match(/^\/api\/jobs\/([a-f0-9-]{36})\/(cancel|retry)$/);if(job&&req.method==='POST')return json(res,await queueRequest('jobs/'+job[1]+'/'+job[2],'POST',{}));
  if(pathname==='/api/backup'&&req.method==='POST'){idleProxy();const d=await body(req);if(typeof d.password!=='string'||d.password.length<12)throw error('备份密码至少 12 个字符');restoring=true;try{await pause();return json(res,encryptBackup(snapshot(),d.password));}finally{unpause();restoring=false;}}
  if(pathname==='/api/restore'&&req.method==='POST'){idleProxy();
   const d=await body(req,20*1024**2);if(d.confirm!==true)throw error('请确认替换当前配置与任务记录');let backup;try{backup=decryptBackup(d.backup,d.password);if(![2,3].includes(backup.version)||!backup.settings||!backup.queueUser||!backup.states)throw Error();updateSettings(backup.settings,publicSettings(backup.settings));if(!/^[a-f0-9]{64}$/.test(backup.queueUser.hash))throw Error();for(const p of platforms)if(backup.platforms?.[p]?.cookie)cookieInput(p,backup.platforms[p].cookie);for(const f of Object.keys(backup.states))if(!stateFiles.includes(f))throw Error();}catch{throw error('备份密码不正确或文件内容无效');}
   restoring=true;let rollback;
   const apply=v=>{for(const f of stateFiles){if(v.states[f])atomic(state+'/'+f,v.states[f]);else fs.rmSync(state+'/'+f,{force:true});}for(const p of platforms){if(v.platforms[p])atomic(config+'/platform-auth/'+p+'.json',v.platforms[p]);else fs.rmSync(config+'/platform-auth/'+p+'.json',{force:true});}atomic(config+'/queue-user.json',v.queueUser);atomic(config+'/settings.json',v.settings);};
   try{await pause();backup.settings.version=3;for(const c of backup.settings.categories){c.storageId=c.storageId||'main';c.ready=false;delete c.fsType;}
    if(!Array.isArray(backup.states['queue/jobs.json']||[]))throw error('备份中的任务格式错误');
    for(const j of backup.states['queue/jobs.json']||[]){if(!/^[a-f0-9-]{36}$/.test(j.id)||!['queued','resolving','downloading','checking','completed','failed','cancelled'].includes(j.state))throw error('备份中的任务格式错误');const c=backup.settings.categories.find(c=>c.id===j.category);if(c){let folder;try{folder=categoryPath(c,roots);}catch{delete j.target;delete j.partial;continue;}if(j.target)j.target=folder+'/'+path.basename(j.target);if(j.partial)j.partial=folder+'/.cobalt-partials/'+j.id+'.part';}else{delete j.target;delete j.partial;if(['queued','resolving','downloading','checking'].includes(j.state)){j.state='cancelled';j.error='原分类已不存在，请重新选择分类提交';}}j.owner=backup.settings.queueUsername;}
    rollback=snapshot();atomic(config+'/pre-restore.json',rollback);apply(backup);sessions.clear();return json(res,{ok:true,message:'已恢复。重新登录后核对页面地址和媒体路径，确认媒体盘后恢复下载。'});
   }catch(e){if(rollback)apply(rollback);throw e;}finally{unpause();restoring=false;}

  }
  throw error('接口不存在',404);
 }
 if(req.method!=='GET')throw error('不支持的方法',405);
 const assets={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};if(!assets[pathname])throw error('页面不存在',404);
 res.writeHead(200,{'Content-Type':pathname.endsWith('.js')?'text/javascript; charset=utf-8':pathname.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; frame-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'"});fs.createReadStream(new URL('./public/'+assets[pathname],import.meta.url)).pipe(res);
 }catch(e){json(res,{error:e.status?e.message:'操作未完成，请检查服务状态后重试'},e.status||500);}});
server.on('upgrade',(req,socket,head)=>{let s;try{sameOrigin(req);s=session(req);if(process.env.BROWSER_LOGIN_ENABLED!=='true'||!s||new URL(req.url,'http://local').pathname!=='/browser/websockify')throw Error();}catch{socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}const upstream=net.connect(6080,'browser',()=>{const headers={...req.headers,host:'browser:6080'};delete headers.cookie;upstream.write('GET /websockify HTTP/1.1\r\n'+Object.entries(headers).map(([k,v])=>k+': '+v).join('\r\n')+'\r\n\r\n');if(head.length)upstream.write(head);socket.pipe(upstream).pipe(socket);});const item={socket,session:s.id};websockets.add(item);socket.on('close',()=>{upstream.destroy();websockets.delete(item);});socket.on('error',()=>upstream.destroy());upstream.on('error',()=>socket.destroy());});
server.requestTimeout=60000;server.headersTimeout=15000;server.listen(Number(process.env.PORT||9090),'0.0.0.0',()=>console.log('Management console ready'));
setInterval(()=>{for(const[k,v]of sessions)if(v.expires<Date.now())sessions.delete(k);for(const ws of websockets)if(!sessions.has(ws.session))ws.socket.destroy();for(const[k,v]of attempts)if(v.until<Date.now())attempts.delete(k);},30000).unref();
