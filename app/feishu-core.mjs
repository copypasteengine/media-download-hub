import crypto from 'node:crypto';
import {DEFAULT_CATEGORIES,categoryLabel,activeCategories} from './categories.mjs';
import {mainKeyboard,menuLabels} from './telegram-ui.mjs';
export const feishuHelp='点击卡片中的下载分类，再发送链接；分类名称和存储路径由管理后台配置。我的下载可查看进度、取消或重试，清晰度设置后续下载画质，登录状态查看平台最近检查结果。发送“菜单”重新显示最新分类。选择 15 分钟有效，每次最多 5 个链接。';
export const digest=s=>crypto.createHash('sha256').update(s).digest('hex').slice(0,32);
export function normalizedMessage(data){
 const m=data.message,s=data.sender;
 if(!m||m.chat_type!=='p2p'||s?.sender_type!=='user'||!s.sender_id?.open_id||!m.chat_id||!m.message_id)return null;
 let body;try{body=JSON.parse(m.content||'{}');}catch{return null;}
 let text='';
 if(m.message_type==='text')text=body.text||'';
 else if(m.message_type==='post'){
  const p=body.content?body:Object.values(body).find(v=>v?.content);
  text=[p?.title,...(p?.content||[]).flat().map(x=>x.href||x.text||'')].filter(Boolean).join('\n');
 }else return null;
 return {id:'message:'+m.message_id,kind:'message',userId:s.sender_id.open_id,chatId:m.chat_id,text:String(text).slice(0,12000),replyId:m.parent_id||null};
}
export function normalizedAction(data,{categories=DEFAULT_CATEGORIES}={}){
 const c=data.context||{},v=data.action?.value,userId=data.operator?.open_id,chatId=c.open_chat_id||data.open_chat_id;
 const messageId=c.open_message_id||data.open_message_id;
 if(!userId||!chatId||!messageId||!v)return null;
 if(v.kind==='menu'&&![...Object.values(menuLabels),...activeCategories(categories).map(categoryLabel)].includes(v.label))return null;
 if(v.kind==='callback'&&!/^(?:menu:(?:open|close|jobs|quality|login|help|category:[a-z][a-z0-9_-]{0,31})|quality:(?:360|480|720|1080|1440|2160|max)|jobs:\d{1,6}|(?:job|cancel|retry):[a-f0-9-]{36})$/.test(v.data||''))return null;
 if(!['menu','callback'].includes(v.kind))return null;
 // event_id/token identifies one click, not a button: later refresh clicks remain usable.
 const identity=data.event_id||data.token;
 if(!identity)return null;
 return {id:'action:'+digest(identity),kind:'action',userId,chatId,messageId,value:v};
}
export function isOwner(owner,item){return !!owner&&owner.userId===item.userId&&owner.chatId===item.chatId;}
export function acceptIncoming(state,item,pairingCode){
 if(!item)return false;
 if(state.owner){if(!isOwner(state.owner,item))return false;}
 else if(item.kind!=='message'||item.text.trim()!=='/start '+pairingCode)return false;
 if(state.inbox.some(x=>x.id===item.id)||state.seen.includes(item.id))return true;
 if(state.inbox.length>=100)throw Error('Authorized message backlog full');
 state.inbox.push({...item,attempts:0,nextAttempt:0});return true;
}
export function messageCard(text,extra={}){
 const markup=extra.reply_markup||{};
 let rows=markup.inline_keyboard;
 if(markup.keyboard)rows=markup.keyboard.map(row=>row.map(label=>({text:label,value:{kind:'menu',label}})));
 if(!rows&&markup.force_reply)rows=[[{text:menuLabels.home,value:{kind:'menu',label:menuLabels.home}}]];
 if(!rows)rows=[[{text:'返回菜单',value:{kind:'menu',label:menuLabels.home}}]];
 return {config:{wide_screen_mode:true,enable_forward:false},elements:[{tag:'div',text:{tag:'plain_text',content:text.slice(0,3900)}},...rows.map(row=>({tag:'action',actions:row.map(b=>({tag:'button',text:{tag:'plain_text',content:b.text},type:'default',value:b.value||{kind:'callback',data:b.callback_data}}))}))]};
}
export {mainKeyboard,menuLabels};
