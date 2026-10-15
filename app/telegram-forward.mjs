import crypto from 'node:crypto';
import {attachmentLabels,recommendedCategory} from './attachment-types.mjs';
import {ownerAllowed} from './telegram-core.mjs';
import {activeCategories} from './categories.mjs';

// Video attachments always require an explicit destination; other types follow configured routes. Keep requests in
// bot state so a restart or an uncertain queue response cannot lose or duplicate them.
export function createForwardFlow({state,save,send,telegram,queue,categories,showJob,now=()=>Date.now()}){
 const choices=()=>activeCategories(categories);
 const requests=()=>state.forwardRequests||(state.forwardRequests={});
 const buttons=p=>{const recommended=choices().find(c=>c.id===p.preferredCategory)||recommendedCategory(choices(),p.kind);const list=choices().sort((a,b)=>Number(b.id===recommended?.id)-Number(a.id===recommended?.id)).map(c=>({text:(c.id===recommended?.id?'推荐 · ':'')+c.name,callback_data:`forward:${p.id}:${c.id}`})),rows=[];for(let i=0;i<list.length;i+=2)rows.push(list.slice(i,i+2));rows.push([{text:'不保存',callback_data:`forward:${p.id}:_cancel`}]);return {inline_keyboard:rows};};
 async function submit(p){
  const category=choices().find(c=>c.id===p.category);
  if(!category){await send('已选择的分类已停用或删除，本组附件未继续下载。请重新转发后选择新的分类。');return;}
  let added=0;
  for(const item of p.items){
   if(item.jobId)continue;
   const r=await queue('jobs','POST',{source:item.source,category:p.category,requestId:item.requestId});
   item.jobId=r.job.id;state.watches||={};state.watches[r.job.id]={lastState:r.job.state,notified:['completed','failed','cancelled'].includes(r.job.state)};save();added++;
   if(showJob)await showJob(r.job,(r.duplicate?'任务已存在：':'已加入下载队列：')+'\n');
  }
  if(added)await send(`已将附件加入「${category.name}」下载队列。视频仍每次询问位置，其它附件按后台规则处理。`);
 }
 async function receive(msg,source,updateId){
  const all=requests();for(const [id,p]of Object.entries(all))if(p.expires<now())delete all[id];
  const kind=source.kind||'video';
  const intent=state.awaitingLink;
  const id=crypto.createHash('sha256').update(msg.media_group_id?'album:'+msg.media_group_id+(kind==='video'?'':':'+kind):'update:'+updateId).digest('hex').slice(0,12);
  let p=all[id];if(!p){if(Object.keys(all).length>=50){await send('待选择位置的附件过多，请先处理已有保存提示。');return;}p=all[id]={id,kind,items:[],expires:now()+24*3600000,category:null,promptSent:false};}
  if(p.cancelled)return;
  const requestId=`tg:${updateId}:attachment`;
  if(!p.items.some(x=>x.requestId===requestId)){if(p.items.length>=100){await send('这一组附件过多，请分批转发。');return;}p.items.push({source,requestId});}
  if(!p.category&&!p.promptSent&&kind!=='video'){
   const recommendation=recommendedCategory(choices(),kind);
   if(intent){
    // An explicit or expired private selection must never fall back to an automatic public route.
    if(intent.expires>=now()&&choices().some(c=>c.id===intent.category))p.preferredCategory=intent.category;
   }else if(recommendation?.ready&&recommendation.autoSaveAttachments){p.category=recommendation.id;}
  }
  state.awaitingLink=null;save();
  if(p.category){await submit(p);return;}
  if(!p.promptSent){const r=await send('收到'+(attachmentLabels[kind]||'文件')+'，请选择保存位置。选择前不会开始下载；同组同类型附件只需选择一次。此提示 24 小时内有效。',{reply_markup:buttons(p)});p.messageId=r?.message_id;p.promptSent=true;save();}
 }
 async function callback(q){
  const match=String(q.data||'').match(/^forward:([a-f0-9]{12}):([\w-]+)$/);if(!match)return false;
  if(!ownerAllowed(state.owner,{...q.message,from:q.from}))return true;
  await telegram('answerCallbackQuery',{callback_query_id:q.id}).catch(()=>{});
  const p=requests()[match[1]],category=match[2];
  if(!p||p.expires<now()||p.cancelled){await send('这条保存提示已结束或过期，请重新转发附件。');return true;}
  if(p.category&&p.category!==category){await send('这组附件已经选择了保存位置。要取消下载，请打开「我的下载」。');return true;}
  if(category==='_cancel'){p.cancelled=true;save();await send('这组转发附件不保存。');return true;}
  if(!choices().some(c=>c.id===category)){await send('这个分类已停用或删除，请重新转发后选择当前分类。');return true;}
  p.category=category;save();
  try{await submit(p);await telegram('editMessageReplyMarkup',{chat_id:q.message.chat.id,message_id:q.message.message_id,reply_markup:{inline_keyboard:[]}}).catch(()=>{});}
  catch(e){if(!e.permanent)throw e;await send('部分附件未能入队，请检查任务列表后重试：'+e.message);}
  return true;
 }
 return {receive,callback};
}
