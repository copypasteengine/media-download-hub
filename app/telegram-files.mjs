import path from 'node:path';
import fs from 'node:fs';
import {Readable} from 'node:stream';
import {openCachedTelegramFile} from './telegram-cache.mjs';
import {telegramApiBase} from './telegram-mode.mjs';
import {runtimeRequire} from '../manager/dependencies.mjs';
export const TELEGRAM_CLOUD_LIMIT=20*1024**2;
const extensions=new Set(['.mp4','.mkv','.webm','.mov','.m4v','.avi','.ts']);
const bad=message=>Object.assign(new Error(message),{status:400,permanent:true});
export function telegramAttachment(msg,options){
 const media=msg.video||msg.video_note||msg.animation||msg.document;
 if(!media)return null;
 const ext=path.extname(media.file_name||'').toLowerCase();
 if(msg.document&&!extensions.has(ext)&&!String(media.mime_type||'').startsWith('video/'))throw bad('这个附件不是支持的视频文件，请转发视频或以文件方式发送视频。');
 const caption=String(msg.caption||'').split('\n').map(s=>s.replace(/https?:\/\/\S+/g,'').trim()).find(Boolean)||'';
 const date=new Date((Number(msg.date)||Date.now()/1000)*1000).toISOString().replace(/[-:]/g,'').slice(0,15);
 return validateTelegramAttachment({type:'telegram',fileId:media.file_id,uniqueId:media.file_unique_id,size:media.file_size,
  filename:extensions.has(ext)?media.file_name:`Telegram_${date}_${msg.message_id||'video'}.mp4`,
  title:caption.slice(0,500),width:media.width||media.length,height:media.height||media.length,duration:media.duration},options);
}
export function validateTelegramAttachment(raw,{local=false}={}){
 if(!raw||raw.type!=='telegram'||typeof raw.fileId!=='string'||!/^[-\w]{5,512}$/.test(raw.fileId)||typeof raw.uniqueId!=='string'||!/^[-\w]{3,256}$/.test(raw.uniqueId))throw bad('Telegram 视频信息不完整，请重新转发原视频。');
 if(raw.size!==undefined&&(!Number.isSafeInteger(raw.size)||raw.size<1))throw bad('Telegram 文件大小无效');
 if(!local&&raw.size>TELEGRAM_CLOUD_LIMIT)throw bad('这个视频超过 20 MB。当前 Telegram 官方 Bot 接口无法下载，需要先配置自建 Bot API 大文件服务（需要你自己的 api_id / api_hash）。');
 const filename=path.basename(String(raw.filename||'Telegram_video.mp4').replaceAll('\\','/')).slice(0,500);
 if(!extensions.has(path.extname(filename).toLowerCase()))throw bad('不支持此视频文件格式');
 const result={type:'telegram',fileId:raw.fileId,uniqueId:raw.uniqueId,filename,title:String(raw.title||'').slice(0,500)};
 if(raw.size)result.size=raw.size;
 for(const k of ['width','height','duration'])if(Number.isFinite(raw[k])&&raw[k]>0&&raw[k]<1000000)result[k]=raw[k];
 return result;
}
export function telegramFilePath(raw){
 if(typeof raw!=='string'||!raw||raw.length>1024||raw.startsWith('/')||!/^[-\w./]+$/.test(raw)||raw.split('/').some(p=>!p||p==='.'||p==='..'))throw bad('Telegram 返回了无效文件路径');
 return raw;
}
// Only this function handles token-bearing URLs. Never persist or expose those URLs.
export async function openTelegramFile(raw,{token,proxy,local=false,cacheRoot='/telegram-data',signal,fetchImpl=fetch,makeDispatcher}={}){
 const source=validateTelegramAttachment(raw,{local});
 if(!/^\d{5,15}:[A-Za-z0-9_-]{20,}$/.test(token||''))throw bad('Telegram Bot 尚未配置');
 if(raw.botId&&raw.botId!==token.split(':')[0])throw bad('该任务属于之前的 Telegram Bot，请向当前 Bot 重新转发视频。');
 const dispatcher=local?new (runtimeRequire('undici').Agent)({headersTimeout:6*3600000,bodyTimeout:0}):proxy?(makeDispatcher?makeDispatcher(proxy):new (runtimeRequire('undici').ProxyAgent)(proxy)):undefined;
 let cached;const close=async()=>{cached?.close();await dispatcher?.destroy();};
 try{
  let r,d;
  try{r=await fetchImpl(`${telegramApiBase(local)}/bot${token}/getFile`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({file_id:source.fileId,...(local?{_expected_size:source.size}:{})}),dispatcher,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(local?6*3600000:30000)])});d=await r.json();}
  catch{throw bad('Telegram 文件信息获取失败，请检查下载服务代理后重试。');}
  if(!r.ok||!d.ok){if(/too big/i.test(d.description||''))throw bad('该视频超过 Telegram 官方 Bot 的 20 MB 下载限制，需要自建 Bot API 大文件服务。');throw bad('Telegram 暂时无法提供这个文件，请重试或重新转发原视频。');}
  if(!local&&d.result?.file_size>TELEGRAM_CLOUD_LIMIT)throw bad('该视频超过 Telegram 官方 Bot 的 20 MB 下载限制，需要自建 Bot API 大文件服务。');
  if(local){
   try{cached=openCachedTelegramFile(d.result?.file_path,cacheRoot,token);}catch{throw bad('Telegram 本地缓存不可用或路径无效，请重试。');}
   if(!cached.size||(source.size&&cached.size!==source.size)||(d.result.file_size&&cached.size!==d.result.file_size))throw bad('Telegram 本地缓存大小不符，请重新下载。');
   const body=Readable.toWeb(fs.createReadStream(null,{fd:cached.fd,autoClose:false,signal}));
   return {response:new Response(body,{headers:{'content-type':'application/octet-stream','content-length':String(cached.size)}}),close,size:cached.size,local:true};
  }
  const filePath=telegramFilePath(d.result?.file_path);
  let response;try{response=await fetchImpl(`https://api.telegram.org/file/bot${token}/${filePath}`,{dispatcher,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(10*60000)])});}catch{throw bad('Telegram 文件连接失败，请检查下载服务代理后重试。');}
  if(!response.ok||!response.body){await response.body?.cancel();throw bad('Telegram 文件下载暂时不可用，请重试。');}
  return {response,close,size:d.result?.file_size||source.size||null};
 }catch(e){await close();throw e;}
}
export function telegramPostLink(url){try{return ['t.me','telegram.me','www.t.me'].includes(new URL(url).hostname.toLowerCase());}catch{return false;}}

export async function attachmentCategory(msg,parsed,{state,resolve,save}){
 const groupId=parsed.attachment&&msg.media_group_id?String(msg.media_group_id):null;
 const remembered=groupId&&state.attachmentGroups?.[groupId];
 if(remembered)return remembered.category;
 const category=await resolve(msg,parsed);if(!category)return null;
 if(groupId){state.attachmentGroups||={};state.attachmentGroups[groupId]={category,at:Date.now()};
  const ids=Object.keys(state.attachmentGroups);for(const id of ids.slice(0,Math.max(0,ids.length-100)))delete state.attachmentGroups[id];save();}
 return category;
}
