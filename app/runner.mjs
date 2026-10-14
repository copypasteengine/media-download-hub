import fs from 'node:fs';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {categoryPath} from './storage.mjs';
import {botCategories} from './categories.mjs';
import {read,atomic,xrayConfig,apiOrigin} from '../manager/core.mjs';
const role=process.argv[2],dir=process.env.CONFIG_DIR||'/config';
let child,signature='',stopping=false,reloading=false,nextStart=0;
const statusFile=`/status/${role}.json`;
function heartbeat(state){try{atomic(statusFile,{role,state,pid:child?.pid||null,updatedAt:new Date().toISOString()});}catch{}}
function config(s){
 const shared={categories:botCategories(s.categories),defaultCategory:s.defaultCategory,menuVersion:crypto.createHash('sha256').update(JSON.stringify(botCategories(s.categories))).digest('hex').slice(0,12),queueUrl:'http://queue:9080',queueUsername:s.queueUsername,queuePassword:s.queuePassword};
 if(role==='queue'){const credentials=read(dir+'/queue-user.json');return {cmd:'node',args:['/project/app/server.mjs'],env:{QUEUE_CONFIG:'/tmp/service.json'},disabled:!s.categories.some(c=>c.enabled&&c.ready),data:{users:{[s.queueUsername]:credentials},categories:s.categories.map(c=>({...c,path:c.ready?categoryPath(c):''})),defaultCategory:s.defaultCategory,stateDir:process.env.SERVICE_STATE_DIR||'/state/queue',reserveBytes:s.reserveGiB*1024**3,maxFileBytes:s.maxFileGiB*1024**3,ffmpeg:process.env.FFMPEG_PATH||'/usr/local/bin/ffmpeg',apiInternal:'http://cobalt:9000/',apiPublic:apiOrigin}};}
 if(role==='telegram')return {cmd:'node',args:['/project/app/telegram.mjs'],env:{BOT_CONFIG:'/tmp/service.json'},disabled:!s.telegram.enabled,data:{...s.telegram,...shared,statePath:(process.env.SERVICE_STATE_DIR||'/state/queue')+'/telegram.json',proxy:'http://proxy:1080'}};
 if(role==='feishu')return {cmd:'node',args:['/project/app/feishu.mjs'],env:{FEISHU_CONFIG:'/tmp/service.json'},disabled:!s.feishu.enabled,data:{...s.feishu,...shared}};
 if(role==='proxy')return {cmd:'/usr/local/bin/xray',args:['run','-config','/tmp/service.json'],data:xrayConfig(s)};
 if(role==='api')return {cmd:'node',args:['src/cobalt'],cwd:'/app',env:{API_URL:apiOrigin,API_PORT:'9000',CORS_WILDCARD:'0',CORS_URL:apiOrigin,COOKIE_PATH:'/config/cookies.json',HTTP_PROXY:'http://proxy:1080',HTTPS_PROXY:'http://proxy:1080',NO_PROXY:'localhost,127.0.0.1,queue,api,*.bilibili.com,*.bilivideo.com,*.hdslb.com',PROCESSING_PRIORITY:'10'}};
 throw Error('Unknown service');
}
async function stopChild(){if(!child)return;const p=child;await new Promise(resolve=>{const timer=setTimeout(()=>p.kill('SIGKILL'),10000);p.once('exit',()=>{clearTimeout(timer);resolve();});p.kill('SIGTERM');});if(child===p)child=null;}
async function tick(){if(stopping||reloading)return;reloading=true;try{
 const s=read(dir+'/settings.json');if(!s||!fs.existsSync(dir+'/admin.json')){heartbeat('awaiting-setup');return;}
 if(fs.existsSync(dir+'/maintenance')){await stopChild();signature='';heartbeat('maintenance');return;}
 const c=config(s);const sig=crypto.createHash('sha256').update(JSON.stringify(c)).digest('hex');
 if(sig!==signature){if(role==='queue'&&child&&!c.disabled){atomic('/tmp/service.json',c.data);child.kill('SIGHUP');}else await stopChild();signature=sig;nextStart=0;}
 if(c.disabled){heartbeat('disabled');return;}
 if(!child&&Date.now()>nextStart){if(role==='queue'){let ready=false;try{ready=(await fetch('http://cobalt:9000/',{signal:AbortSignal.timeout(3000)})).ok;}catch{}if(!ready){heartbeat('waiting-upstream');return;}}if(c.data)atomic('/tmp/service.json',c.data);child=spawn(c.cmd,c.args,{cwd:c.cwd,env:{...process.env,...c.env},stdio:'inherit'});const p=child;p.once('exit',()=>{if(child===p)child=null;nextStart=Date.now()+15000;});p.once('error',()=>{console.log(role+' process failed to start');});}
 heartbeat(child?'running':'retrying');
 }catch{heartbeat('configuration-error');}finally{reloading=false;}}
process.on('SIGTERM',async()=>{stopping=true;await stopChild();process.exit(0);});process.on('SIGINT',()=>process.emit('SIGTERM'));
setInterval(tick,2500);void tick();
