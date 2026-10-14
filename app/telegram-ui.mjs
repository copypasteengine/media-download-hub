import {DEFAULT_CATEGORIES,activeCategories,categoryLabel} from './categories.mjs';
import {statusText} from './login-health-core.mjs';
import {helpText,ownerAllowed,jobText} from './telegram-core.mjs';
export const MENU_VERSION=4;
export const menuLabels={jobs:'📋 我的下载',login:'🔑 登录状态',quality:'⚙️ 清晰度',help:'❓ 使用帮助',home:'↩️ 返回主菜单'};
export function makeKeyboard(categories=DEFAULT_CATEGORIES){const buttons=activeCategories(categories).map(categoryLabel),rows=[];for(let i=0;i<buttons.length;i+=2)rows.push(buttons.slice(i,i+2));return {keyboard:[...rows,[menuLabels.jobs,menuLabels.quality],[menuLabels.login,menuLabels.help],[menuLabels.home]],resize_keyboard:true,is_persistent:true,input_field_placeholder:'点菜单选择分类，或发送链接到默认分类'};}
export const mainKeyboard=makeKeyboard();
export function jobKeyboard(j){
 const buttons=[{text:'刷新进度',callback_data:'job:'+j.id}];
 if(['queued','resolving','downloading','checking'].includes(j.state))buttons.push({text:'取消下载',callback_data:'cancel:'+j.id});
 if(['failed','cancelled'].includes(j.state))buttons.push({text:'重新下载',callback_data:'retry:'+j.id});
 return {inline_keyboard:[buttons]};
}
export function createUI({state,save,send,telegram,queue,categories=DEFAULT_CATEGORIES,defaultCategory=categories[0]?.id,now=()=>Date.now()}){
 const mainKeyboard=makeKeyboard(categories);
 const findCategory=id=>activeCategories(categories).find(c=>c.id===id);
 async function home(text='请选择下面的操作。点击下载分类后，按提示粘贴视频链接即可。'){
  state.awaitingLink=null;save();return send(text,{reply_markup:mainKeyboard});
 }
 async function prompt(category){
  const selected=findCategory(category);if(!selected)return home('该分类已停用或删除，请重新选择。');
  // Persist intent before sending; old prompts can never silently select another library.
  state.awaitingLink={category,expires:now()+15*60000,promptId:null};save();
  const r=await send(`请发送要保存到「${selected.name}」的视频链接。\n一次最多 5 个链接；本次选择只用于下一条链接消息。`,{reply_markup:{force_reply:true,input_field_placeholder:'粘贴视频链接后发送',selective:true}});
  state.awaitingLink.promptId=r.message_id;
  state.linkPrompts=[...(state.linkPrompts||[]),r.message_id].slice(-30);save();
 }
 async function quality(){
  return send('当前优先清晰度：'+(state.quality==='max'?'最高可用':state.quality+'p')+'。点击选择后，对之后的下载生效。',{reply_markup:{inline_keyboard:[[{text:'360p',callback_data:'quality:360'},{text:'480p',callback_data:'quality:480'},{text:'720p',callback_data:'quality:720'}],[{text:'1080p',callback_data:'quality:1080'},{text:'1440p',callback_data:'quality:1440'},{text:'4K',callback_data:'quality:2160'}],[{text:'最高可用',callback_data:'quality:max'}]]}});
 }
 async function showJob(j,prefix=''){return send(prefix+jobText(j),{reply_markup:jobKeyboard(j)});}
 async function jobs(offset=0){
  const d=await queue('jobs'),list=d.jobs||[];const start=Math.max(0,Math.min(offset,Math.max(0,Math.floor((list.length-1)/5)*5)));
  if(!list.length)return send('暂无下载任务。选择菜单中的下载分类开始。',{reply_markup:mainKeyboard});
  for(const j of list.slice(start,start+5))await showJob(j);
  const row=[];if(start>0)row.push({text:'上一页',callback_data:'jobs:'+Math.max(0,start-5)});if(start+5<list.length)row.push({text:'下一页',callback_data:'jobs:'+(start+5)});row.push({text:'刷新列表',callback_data:'jobs:'+start});
  return send(`显示第 ${start+1}–${Math.min(start+5,list.length)} 项，共 ${list.length} 项。`,{reply_markup:{inline_keyboard:[row]}});
 }
 async function menuMessage(msg){
  const text=String(msg.text||'').trim();
  const selected=activeCategories(categories).find(c=>categoryLabel(c)===text);if(selected){await prompt(selected.id);return true;}
  if(/^[📥🔒]/u.test(text)&&text.includes('下载到')){await home('这个分类按钮已过期，请使用当前菜单。');return true;}
  if(text===menuLabels.home){await home();return true;}
  if(text===menuLabels.jobs){await jobs();return true;}
  if(text===menuLabels.login){await send(statusText(await queue('platform-status')),{reply_markup:mainKeyboard});return true;}
  if(text===menuLabels.quality){await quality();return true;}
  if(text===menuLabels.help){await send(helpText,{reply_markup:mainKeyboard});return true;}
  return false;
 }
 async function resolveCategory(msg,parsed){
  const replied=msg.reply_to_message?.message_id;
  if(replied&&(state.linkPrompts||[]).includes(replied)&&state.awaitingLink?.promptId!==replied){await home('这个链接输入步骤已经结束，请重新选择下载分类，再发送链接。');return null;}
  if(parsed.explicitCategory){if(!findCategory(parsed.category)){await home('该分类已停用，请重新选择。');return null;}return parsed.category;}
  if(state.awaitingLink){
   if(state.awaitingLink.expires<now()){await home('上次选择已经超时，本条链接没有提交。请重新选择分类后发送。');return null;}
   if(!findCategory(state.awaitingLink.category)){await home('上次选择的分类已停用或删除，请重新选择。');return null;}
   return state.awaitingLink.category;
  }
  const category=parsed.category||defaultCategory;if(!findCategory(category)){await home('默认分类不可用，请重新选择。');return null;}return category;
 }
 async function callback(q){
  if(!ownerAllowed(state.owner,{...q.message,from:q.from}))return;
  await telegram('answerCallbackQuery',{callback_query_id:q.id}).catch(()=>{});
  const data=String(q.data||'');
  if(/^quality:(360|480|720|1080|1440|2160|max)$/.test(data)){
   state.quality=data.split(':')[1];save();await send('后续下载优先使用 '+(state.quality==='max'?'最高可用画质':state.quality+'p')+'，实际以平台允许的画质为准。',{reply_markup:mainKeyboard});return;
  }
  if(/^jobs:\d{1,6}$/.test(data)){await jobs(Number(data.split(':')[1]));return;}
  const m=data.match(/^(job|cancel|retry):([a-f0-9-]{36})$/);if(!m)return;
  const d=await queue('jobs'),j=d.jobs.find(j=>j.id===m[2]);if(!j){await send('这个任务已不存在。',{reply_markup:mainKeyboard});return;}
  if(m[1]==='job'){await showJob(j);return;}
  if(m[1]==='cancel'&&!['queued','resolving','downloading','checking'].includes(j.state)){await showJob(j,'任务状态已变化：\n');return;}
  if(m[1]==='retry'&&!['failed','cancelled'].includes(j.state)){await showJob(j,'任务已经开始或完成，无需重复下载。\n');return;}
  const r=await queue('jobs/'+j.id+'/'+m[1],'POST',{});
  if(m[1]==='retry'){state.watches[j.id]={lastState:'queued'};save();}
  await showJob(r.job,m[1]==='cancel'?'已提交取消请求。\n':'已重新加入下载队列。\n');
 }
 return {home,prompt,quality,jobs,showJob,menuMessage,resolveCategory,callback};
}
