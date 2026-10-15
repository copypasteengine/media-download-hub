import {telegramPostLink} from './telegram-files.mjs';

// Forwarded links always ask again, even if a previous menu prompt is pending.
// Ordinary links may consume an explicit menu/command choice, never a default.
export async function handleVideoLinks({msg,parsed,updateId,ui,forwards,queue,state,save,send}){
 const urls=parsed.urls.filter(url=>!telegramPostLink(url));
 if(urls.length!==parsed.urls.length)await send('这是 Telegram 消息链接。请在 Telegram 打开该消息，直接把附件转发给我；仅凭链接无法读取频道或私聊的文件。');
 if(!urls.length)return;
 const forwarded=!!(msg.forward_origin||msg.forward_date||msg.forward_from||msg.forward_from_chat||msg.forward_sender_name);
 const category=forwarded?undefined:await ui.resolveCategory(msg,parsed);
 if(category===undefined){await forwards.receiveLinks(msg,urls,updateId,{excess:parsed.excess});return;}
 if(category===null)return;
 for(const [i,url] of urls.entries()){
  try{
   const r=await queue('jobs','POST',{url,quality:state.quality,category,requestId:`tg:${updateId}:${i}`});
   state.watches[r.job.id]={lastState:r.job.state,notified:['completed','failed','cancelled'].includes(r.job.state)};save();
   await ui.showJob(r.job,(r.duplicate?'此任务已存在，没有重复下载。':'已加入下载队列，可关闭 Telegram。')+'\n');
  }catch(e){if(!e.permanent)throw e;await send('无法提交：'+e.message);}
 }
 await ui.home(parsed.excess?'已处理前 5 个链接。其余请重新选择分类后发送。':'本次链接已处理。可以点菜单继续添加，或查看下载任务。');
}
