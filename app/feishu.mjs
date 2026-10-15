import fs from 'node:fs';
import {deliverLoginAlerts} from './login-health-core.mjs';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {createUI,jobKeyboard,makeKeyboard} from './telegram-ui.mjs';
import {parseMessage,jobText,helpText,shouldNotifyJob} from './telegram-core.mjs';
import {createQueueClient} from './queue-client.mjs';
import {normalizedMessage,normalizedAction,isOwner,acceptIncoming,messageCard,feishuHelp,digest,menuLabels} from './feishu-core.mjs';
const require=createRequire('/feishu-runtime/package.json'),lark=require('@larksuiteoapi/node-sdk');
const cfg=JSON.parse(fs.readFileSync(process.env.FEISHU_CONFIG||'/run/feishu/config.json','utf8'));
const categories=cfg.categories,mainKeyboard=makeKeyboard(categories);
if(!cfg.appId||!cfg.appSecret||!cfg.pairingCode)throw Error('Feishu credentials not configured');
const stateDir=process.env.SERVICE_STATE_DIR||'/state/feishu',stateFile=stateDir+'/feishu.json';
const state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):{owner:null,quality:'1080',watches:{},inbox:[],seen:[]};
state.inbox??=[];state.seen??=[];state.watches??={};
let stopping=false,working=false,notifying=false,current=null,sendIndex=0;
function save(){const temp=stateFile+'.new';fs.writeFileSync(temp,JSON.stringify(state),{mode:0o600});const fd=fs.openSync(temp,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,stateFile);}
function safeError(e){return {name:e?.name||'Error',code:typeof e?.code==='number'||/^[A-Z_0-9]{1,50}$/.test(e?.code||'')?e.code:undefined,http:e?.response?.status};}
// SDK debug/error objects may contain credentials and private text; don't print them.
const logger={trace(){},debug(){},info(){},warn(){console.log('Feishu SDK warning');},error(){console.log('Feishu SDK connection/API error');}};
lark.defaultHttpInstance.defaults.timeout=20000;
lark.defaultHttpInstance.defaults.proxy=false;
const client=new lark.Client({appId:cfg.appId,appSecret:cfg.appSecret,domain:lark.Domain.Feishu,logger,loggerLevel:lark.LoggerLevel.warn});
const queue=createQueueClient(cfg);
async function send(text,extra={},uniqueKey){
 if(!state.owner)return;
 const key=uniqueKey||(current?current.id+':send:'+sendIndex++:crypto.randomUUID());
 const res=await client.im.message.create({params:{receive_id_type:'chat_id'},data:{receive_id:state.owner.chatId,msg_type:'interactive',content:JSON.stringify(messageCard(text===helpText?feishuHelp:text,extra)),uuid:digest(key)}});
 if(res.code!==0)throw Object.assign(new Error('Feishu send rejected'),{code:res.code});
 if(!res.data?.message_id)throw Error('Feishu response missing message ID');
 return {message_id:res.data.message_id};
}
const ui=createUI({state,save,send,queue,categories,defaultCategory:cfg.defaultCategory,allowDefaultCategory:true,compactMenu:false,telegram:async()=>{}});
function fakeMessage(item,text=item.text){return {text,from:{id:item.userId,is_bot:false},chat:{id:item.chatId,type:'private'},...(item.replyId?{reply_to_message:{message_id:item.replyId}}:{})};}
async function handle(item){
 if(!state.owner){state.owner={userId:item.userId,chatId:item.chatId};save();}
 if(!isOwner(state.owner,item))return;
 if(item.kind==='action'){
  if(item.value.kind==='menu')return ui.menuMessage(fakeMessage(item,item.value.label));
  return ui.callback({id:item.id,data:item.value.data,from:{id:item.userId,is_bot:false},message:{chat:{id:item.chatId,type:'private'}}});
 }
 const msg=fakeMessage(item),text=item.text.trim();
 if(text.startsWith('/start ')||['菜单','开始','/menu','/start'].includes(text))return ui.home('已连接你的 媒体下载助手。请选择下方操作，再按提示发送视频链接。');
 if(['帮助','/help'].includes(text))return send(feishuHelp,{reply_markup:mainKeyboard});
 if(await ui.menuMessage(msg))return;
 const parsed=parseMessage(msg,cfg);
 if(parsed.command==='status')return ui.jobs();
 if(parsed.command==='quality')return ui.quality();
 if(parsed.command!=='download')return ui.home();
 if(!parsed.urls.length){
  if(parsed.explicitCategory)return ui.prompt(parsed.category);
  if(state.awaitingLink)return send('请直接粘贴视频网页链接并发送，或点“返回主菜单”重新选择。',{reply_markup:{force_reply:true}});
  return ui.home();
 }
 if(!item.resolvedCategory){
  const category=await ui.resolveCategory(msg,parsed);if(!category)return;
  item.resolvedCategory=category;item.resolvedQuality=state.quality;save();
 }
 for(const [index,url] of parsed.urls.entries()){
  try{
   const result=await queue('jobs','POST',{url,quality:item.resolvedQuality,category:item.resolvedCategory,requestId:'feishu:'+digest(item.id)+':'+index});
   state.watches[result.job.id]={lastState:result.job.state,notified:['completed','failed','cancelled'].includes(result.job.state)};save();
   await ui.showJob(result.job,(result.duplicate?'任务已存在，没有重复下载。':'已加入下载队列，可以关闭飞书。')+'\n');
  }catch(e){if(!e.permanent)throw e;await send(categories.find(c=>c.id===item.resolvedCategory)?.private?'私密任务提交失败，请稍后重试或检查磁盘。':'无法提交：'+e.message);}
 }
 await ui.home(parsed.excess?'已处理前 5 个链接，其余请重新选择分类后发送。':'链接已处理，可继续添加或查看下载任务。');
}
async function work(){
 if(working||stopping)return;const item=state.inbox[0];if(!item||item.nextAttempt>Date.now())return;
 working=true;current=item;sendIndex=0;
 try{
  await handle(item);state.inbox.shift();state.seen=[...state.seen,item.id].slice(-2000);state.lastHandledAt=new Date().toISOString();save();
 }catch(e){item.attempts++;item.nextAttempt=Date.now()+Math.min(60000,2000*2**Math.min(item.attempts,5));save();console.log('Feishu operation retry '+JSON.stringify(safeError(e)));}
 finally{current=null;working=false;}
}
async function notify(){
 if(notifying||working||stopping||!state.owner)return;notifying=true;
 try{
  if(state.menuVersion!==cfg.menuVersion){await ui.home('下载分类菜单已更新，请使用新的分类按钮。');state.menuVersion=cfg.menuVersion;save();}
  try{const health=await queue('platform-status');await deliverLoginAlerts({snapshot:health,state,save,send});}
  catch{console.log('Platform login notice temporarily unavailable');}
  const d=await queue('jobs');
  for(const j of d.jobs){const w=state.watches[j.id];if(!w)continue;if(w.notified&&w.notifiedAttempt===undefined){w.notifiedAttempt=j.attempts;save();}if(!shouldNotifyJob(w,j))continue;
   await send(jobText(j)+(j.state==='completed'?'\n已保存到「'+j.categoryName+'」分类。':''),{reply_markup:jobKeyboard(j)},'notice:'+j.id+':'+j.state+':'+j.attempts);
   w.notified=true;w.lastState=j.state;w.notifiedAttempt=j.attempts;save();
  }
 }catch(e){console.log('Feishu notification retry '+JSON.stringify(safeError(e)));}finally{notifying=false;}
}
function ingest(item){
 const accepted=acceptIncoming(state,item,cfg.pairingCode);
 if(accepted){state.lastEventAt=new Date().toISOString();save();}
 return accepted;
}
const dispatcher=new lark.EventDispatcher({logger,loggerLevel:lark.LoggerLevel.warn}).register({
 'im.message.receive_v1':data=>{ingest(normalizedMessage(data));return {};},
 'card.action.trigger':data=>({toast:{type:ingest(normalizedAction(data,{categories}))?'info':'error',content:'操作已接收，稍后在对话中查看结果。'}})
});
let disconnectedAt=Date.now();
const ws=new lark.WSClient({appId:cfg.appId,appSecret:cfg.appSecret,domain:lark.Domain.Feishu,logger,loggerLevel:lark.LoggerLevel.warn,autoReconnect:true,handshakeTimeoutMs:20000,wsConfig:{pingTimeout:20},onReady:()=>console.log('Feishu WebSocket ready'),onReconnected:()=>console.log('Feishu WebSocket reconnected'),onError:()=>console.log('Feishu WebSocket connection failed')});
const workTimer=setInterval(work,500),notifyTimer=setInterval(notify,8000);
const healthTimer=setInterval(()=>{
 const connection=ws.getConnectionStatus();
 if(connection.state==='connected')disconnectedAt=Date.now();
 fs.writeFileSync(stateDir+'/feishu-health.json',JSON.stringify({updatedAt:new Date().toISOString(),connection:connection.state,ownerBound:!!state.owner,pending:state.inbox.length,lastEventAt:state.lastEventAt,lastHandledAt:state.lastHandledAt}),{mode:0o600});
 if(Date.now()-disconnectedAt>300000){console.error('Feishu connection stalled; restarting process');stop(1);}
},15000);
function stop(code=0){if(stopping)return;stopping=true;clearInterval(workTimer);clearInterval(notifyTimer);clearInterval(healthTimer);ws.close({force:true});save();setTimeout(()=>process.exit(code),1000);}
process.on('SIGTERM',()=>stop());process.on('SIGINT',()=>stop());
console.log('Feishu worker starting; owner '+(state.owner?'bound':'awaiting pairing'));
ws.start({eventDispatcher:dispatcher}).catch(e=>{console.error('Feishu startup failed '+JSON.stringify(safeError(e)));stop(1);});
