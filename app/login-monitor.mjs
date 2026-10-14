import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {applyProbe,alertText,statusText} from './login-health-core.mjs';
import {checkBilibili,checkYouTube} from './login-probes.mjs';
export function startLoginMonitor({stateDir,authDir='/config/platform-auth',proxyUrl='http://proxy:1080'}) {
 const file=path.join(stateDir,'platform-login-health.json');
 let state={platforms:{},alerts:[]};
 if(fs.existsSync(file))state=JSON.parse(fs.readFileSync(file,'utf8'));
 let busy=false,stopped=false,proxy;
 const require=createRequire('/runtime/package.json');
 let deps;
 async function youtubeDependencies(){
  if(!deps){const lib=await import(pathToFileURL(require.resolve('youtubei.js')).href);lib.Log?.setLevel(0);deps={Innertube:lib.Innertube,...require('undici')};}
  if(!proxy)proxy=new deps.ProxyAgent(proxyUrl);
  return {Innertube:deps.Innertube,fetchImpl:async(input,init)=>{
   const url=typeof input==='string'?input:input instanceof URL?input:input.url;
   if(!proxy)proxy=new deps.ProxyAgent(proxyUrl);
   const used=proxy;
   try{return await deps.fetch(new deps.Request(url,typeof input==='object'&&!(input instanceof URL)?input:undefined),{...init,dispatcher:used,redirect:'error',signal:AbortSignal.timeout(25000)});}
   catch(e){if(proxy===used){proxy=null;void used.destroy().catch(()=>{});}throw e;}
  }};
 }
 function save(){const tmp=file+'.new';fs.writeFileSync(tmp,JSON.stringify(state),{mode:0o600});fs.renameSync(tmp,file);}
 function add(message,platform,kind){state.alerts.push({id:crypto.randomUUID(),createdAt:new Date().toISOString(),platform,kind,message});state.alerts=state.alerts.slice(-40);}
 async function tick(){
  if(busy||stopped)return;busy=true;
  try{
   for(const platform of ['bilibili','youtube']){
    if(stopped)break;
    let cookie='',badConfig=false;
    try{cookie=JSON.parse(fs.readFileSync(path.join(authDir,platform+'.json'),'utf8')).cookie||'';if(typeof cookie!=='string'||/[\r\n]/.test(cookie)){cookie='';badConfig=true;}}
    catch(e){badConfig=e.code!=='ENOENT';}
    const fingerprint=crypto.createHash('sha256').update(cookie).digest('hex');
    const previous=state.platforms[platform]||{};
    if(previous.fingerprint===fingerprint&&previous.nextCheckAt>Date.now())continue;
    let result;
    try{result=badConfig?{status:'unknown'}:platform==='bilibili'?await checkBilibili(cookie):cookie?await checkYouTube(cookie,await youtubeDependencies()):{status:'unconfigured'};}
    catch{result={status:'unknown'};}
    const {state:next,event}=applyProbe(previous,result);
    state.platforms[platform]={...next,fingerprint};
    if(event)add(alertText(platform,event.kind),platform,event.kind);
    save();
   }
   if(!state.enabledNotice){state.enabledNotice=true;add('平台登录定期检查与失效提醒已启用。\n\n'+statusText(snapshot()),null,'enabled');save();}
  }catch{console.log('Platform login monitor temporarily unavailable');}
  finally{busy=false;}
 }
 function snapshot(){
  return {platforms:Object.fromEntries(Object.entries(state.platforms).map(([p,s])=>[p,{status:s.status,checkedAt:s.checkedAt,lastValidAt:s.lastValidAt,nextCheckAt:s.nextCheckAt}])),alerts:state.alerts};
 }
 const timer=setInterval(tick,60000);timer.unref();void tick();
 return {snapshot,stop(){stopped=true;clearInterval(timer);if(proxy)void proxy.destroy().catch(()=>{});}};
}
