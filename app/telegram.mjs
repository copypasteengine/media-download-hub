import fs from 'node:fs';
import {createForwardFlow} from './telegram-forward.mjs';
import {migrateTelegramMode} from './telegram-mode.mjs';
import {read,atomic} from '../manager/core.mjs';
import {handleVideoLinks} from './telegram-links.mjs';
import {deliverLoginAlerts} from './login-health-core.mjs';
import {createTelegramTransport} from './telegram-transport.mjs';
import {createRequire} from 'node:module';
import {helpText,parseMessage,ownerAllowed,canPair,jobText,findJob,shouldNotifyJob} from './telegram-core.mjs';
import {createUI,collapsedKeyboard,jobKeyboard,MENU_VERSION} from './telegram-ui.mjs';
const cfg=JSON.parse(fs.readFileSync(process.env.BOT_CONFIG||'/run/bot/config.json','utf8'));
const categories=cfg.categories,mainKeyboard=collapsedKeyboard,menuVersion=MENU_VERSION+':'+cfg.menuVersion;
if(!/^\d{5,15}:[A-Za-z0-9_-]{20,}$/.test(cfg.token||''))throw Error('Telegram Token 尚未配置');
const require=createRequire('/runtime/package.json');
const {ProxyAgent}=require('undici');
const statePath=cfg.statePath||'/state/telegram.json';
let state=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):{offset:0,owner:null,quality:'1080',watches:{}};
let session=null,stopping=false,notifying=false;
const shutdown=new AbortController();
const sleep=ms=>new Promise(r=>{const done=()=>{clearTimeout(t);shutdown.signal.removeEventListener('abort',done);r();};const t=setTimeout(done,ms);shutdown.signal.addEventListener('abort',done,{once:true});});
function save(){const tmp=statePath+'.new';fs.writeFileSync(tmp,JSON.stringify(state),{mode:0o600});const fd=fs.openSync(tmp,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,statePath);}
const transport=createTelegramTransport({token:cfg.token,local:!!cfg.local,makeProxy:()=>new ProxyAgent(cfg.proxy||'http://proxy:1080'),signal:shutdown.signal,onFailure:detail=>console.log('Telegram transport failure '+JSON.stringify(detail))});
const telegram=transport.request;
const currentHelp=cfg.local?helpText.replace('当前官方 Bot 接口限单个文件 20 MB。较大文件需要自建 Bot API。','已启用大文件服务，单文件大小及磁盘保留空间按后台设置执行。'):helpText;
async function queue(route,method='GET',data,retried=false){
 if(!session){const r=await fetch(cfg.queueUrl+'/nas/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:cfg.queueUsername,password:cfg.queuePassword}),signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('下载队列登录失败');const cookie=r.headers.get('set-cookie')?.split(';')[0];const me=await fetch(cfg.queueUrl+'/nas/api/me',{headers:{Cookie:cookie},signal:AbortSignal.timeout(10000)}).then(r=>r.json());session={cookie,csrf:me.csrf};}
 const r=await fetch(cfg.queueUrl+'/nas/api/'+route,{method,headers:{Cookie:session.cookie,'X-CSRF-Token':session.csrf,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(15000)});
 if(r.status===401&&!retried){session=null;return queue(route,method,data,true);}
 const d=await r.json();if(!r.ok)throw Object.assign(new Error(d.error||'队列请求失败'),{permanent:r.status>=400&&r.status<500});return d;
}
async function send(text,extra={}){if(!state.owner)return;return telegram('sendMessage',{chat_id:state.owner.chatId,text:text.slice(0,3900),link_preview_options:{is_disabled:true},...extra});}
const ui=createUI({state,save,send,telegram,queue,categories,defaultCategory:cfg.defaultCategory,help:currentHelp});
const forwards=createForwardFlow({state,save,send,telegram,queue,categories,showJob:ui.showJob});
async function handle(update){
 if(update.callback_query){if(!await forwards.callback(update.callback_query))await ui.callback(update.callback_query);return;}
 const msg=update.message;if(!msg)return;
 if(!state.owner){
  if(canPair(cfg.pairingCode,msg)){state.owner={userId:String(msg.from.id),chatId:String(msg.chat.id)};save();await ui.home('已绑定你的 Telegram 账号，其他人和群聊无法控制下载。\n\n'+currentHelp);}
  return;
 }
 if(!ownerAllowed(state.owner,msg))return;
 if(await ui.menuMessage(msg))return;
 let parsed;try{parsed=parseMessage(msg,cfg);}catch(e){if(!e.permanent)throw e;await send(e.message);return;}
 switch(parsed.command){
  case 'start':await ui.home();return;
  case 'menu':await ui.menu();return;
  case 'help':await send(currentHelp,{reply_markup:mainKeyboard});return;
  case 'settings':await ui.quality();return;
  case 'quality':if(!parsed.argument){await ui.quality();return;}if(!['360','480','720','1080','1440','2160','max'].includes(parsed.argument)){await send('支持：360、480、720、1080、1440、2160、max。例如 /quality 720');return;}state.quality=parsed.argument;save();await send('后续任务优先清晰度已设为 '+state.quality+'，实际以平台可提供的画质为准。');return;
  case 'status':await ui.jobs();return;
  case 'cancel':case 'retry':{if(!parsed.argument){await ui.jobs();return;}const d=await queue('jobs'),j=findJob(d.jobs,parsed.argument);if(!j){await send('请填写任务编号，例如 /cancel 1234abcd。先用 /status 查看。');return;}const r=await queue('jobs/'+j.id+'/'+parsed.command,'POST',{});if(parsed.command==='retry'){state.watches[j.id]={lastState:'queued'};save();}await send(jobText(r.job));return;}
  case 'download':break;
  default:await send('发送视频链接即可下载，或用 /help 查看命令。');return;
 }
 if(!parsed.attachment&&!parsed.urls.length){if(state.awaitingLink||parsed.explicitCategory)await ui.prompt(parsed.explicitCategory?parsed.category:state.awaitingLink.category);else await ui.home();return;}
 if(parsed.attachment){await forwards.receive(msg,parsed.attachment,update.update_id);return;}
 await handleVideoLinks({msg,parsed,updateId:update.update_id,ui,forwards,queue,state,save,send});
}
async function notify(){
 if(notifying||!state.owner||stopping)return;notifying=true;
 try{
  try{const health=await queue('platform-status');await deliverLoginAlerts({snapshot:health,state,save,send});}
  catch{console.log('Platform login notice temporarily unavailable');}
  const d=await queue('jobs');
  for(const j of d.jobs){const w=state.watches[j.id];if(!w)continue;if(w.notified&&w.notifiedAttempt===undefined){w.notifiedAttempt=j.attempts;save();}if(shouldNotifyJob(w,j)){
   await send(jobText(j)+(j.state==='completed'?'\n已保存到「'+j.categoryName+'」分类。':j.state==='failed'?'\n点击下方按钮可重新下载。':''),{reply_markup:jobKeyboard(j)});w.lastState=j.state;w.notified=true;w.notifiedAttempt=j.attempts;save();
  }}
 }catch{console.log('Notification temporarily unavailable; retrying later');}finally{notifying=false;}
}
async function main(){
 const modeFile=statePath+'.api-mode.json';
 await migrateTelegramMode({local:!!cfg.local,botId:cfg.token.split(':')[0],previous:read(modeFile),request:async(mode,method)=>{const old=createTelegramTransport({token:cfg.token,local:mode==='local',makeProxy:()=>new ProxyAgent(cfg.proxy||'http://proxy:1080'),signal:shutdown.signal});try{return await old.request(method);}finally{await old.close();}},save:next=>{atomic(modeFile,next);atomic('/status/telegram-route.json',next);}});
 const me=await telegram('getMe');
 fs.writeFileSync((process.env.SERVICE_STATE_DIR||'/state/queue')+'/bot-info.json',JSON.stringify({username:me.username,id:me.id}),{mode:0o600});
 const webhook=await telegram('getWebhookInfo');if(webhook.url)throw Error('该 Bot 已设置 webhook，请使用专用新 Bot，避免干扰现有应用');
 await telegram('setMyCommands',{commands:[{command:'menu',description:'显示操作按钮'},{command:'download',description:'发送链接并选择保存位置'},{command:'help',description:'使用说明'},{command:'status',description:'查看下载任务'},{command:'quality',description:'设置后续任务清晰度'},{command:'cancel',description:'取消任务'},{command:'retry',description:'重试失败任务'}]});
 if(state.owner&&state.menuVersion!==menuVersion){await ui.resetMenu();state.menuVersion=menuVersion;save();}
 console.log('Telegram bot ready; owner '+(state.owner?'bound':'awaiting pairing'));
 const timer=setInterval(notify,8000);timer.unref();
 while(!stopping){
  try{
   const updates=await telegram('getUpdates',{offset:state.offset,timeout:25,limit:10,allowed_updates:['message','callback_query']},40000);
   fs.writeFileSync('/state/bot-health.json',JSON.stringify({lastPollAt:new Date().toISOString(),received:updates.length}),{mode:0o600});
   for(const update of updates){try{await handle(update);}catch(e){if(!e.permanent)throw e;await send('操作未完成：'+e.message);}state.offset=update.update_id+1;save();}
  }catch(e){if(stopping)break;console.log(e.message.startsWith('Telegram API')?e.message:'Bot connection/queue unavailable; will retry');await sleep(Math.min(60000,(e.retryAfter||10)*1000));}
 }
 clearInterval(timer);
}
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>{stopping=true;shutdown.abort();});
main().catch(e=>{console.error(e.message.startsWith('Telegram API')?e.message:'Bot startup failed; verify token, proxy and queue');process.exitCode=1;}).finally(()=>transport.close());
