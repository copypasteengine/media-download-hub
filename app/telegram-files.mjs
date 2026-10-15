import path from 'node:path';
import fs from 'node:fs';
import {Readable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {openCachedTelegramFile} from './telegram-cache.mjs';
import {telegramApiBase} from './telegram-mode.mjs';
import {runtimeRequire} from '../manager/dependencies.mjs';
export const TELEGRAM_CLOUD_LIMIT=20*1024**2;
import {attachmentKind,attachmentExtension} from './attachment-types.mjs';
const bad=message=>Object.assign(new Error(message),{status:400,permanent:true,safeForUser:true});
// getFile is idempotent. A local server reconnect or a busy cancellation must
// not immediately fail a queued video; never retry a user cancellation.
export async function requestTelegramFile(url,options,{fetchImpl=fetch,local=false,wait=delay}={}){
 const attempts=local?3:1;
 for(let i=0;i<attempts;i++){
  options.signal?.throwIfAborted();
  let r,d,networkCode;
  try{r=await fetchImpl(url,options);d=await r.json();}
  catch(e){options.signal?.throwIfAborted();networkCode=e.cause?.code||e.code||'NETWORK_ERROR';}
  if(r?.ok&&d?.ok)return d.result;
  const code=d?.error_code||r?.status;
  const retry=networkCode||[409,429,500,502,503,504].includes(code);
  if(retry&&i+1<attempts){await wait(Math.min(30000,Math.max(3000*(i+1),(d?.parameters?.retry_after||0)*1000)),undefined,{signal:options.signal});continue;}
  if(networkCode)throw bad('Telegram 文件连接中断，请重试；接口错误：'+(/^[A-Z_0-9]{1,50}$/.test(networkCode)?networkCode:'NETWORK_ERROR'));
  if(/too big/i.test(d?.description||''))throw bad('该文件超过 Telegram 官方 Bot 的 20 MB 下载限制，需要自建 Bot API 大文件服务。');
  if(code===413)throw bad('Telegram 缓存盘可用空间不足或文件超过后台大小限制。');
  throw bad('Telegram 暂时无法提供这个文件（接口状态 '+(Number(code)||'未知')+'），请重试或重新转发原文件。');
 }
}
export function telegramAttachment(msg,options){
 const photo=Array.isArray(msg.photo)?[...msg.photo].sort((a,b)=>(b.width*b.height-a.width*a.height)||((b.file_size||0)-(a.file_size||0)))[0]:null;
 const media=msg.video||msg.video_note||msg.animation||photo||msg.audio||msg.voice||msg.document;
 if(!media)return null;
 const mime=String(media.mime_type||'').toLowerCase();
 const kind=msg.video||msg.video_note?'video':msg.animation?(mime==='image/gif'?'image':'video'):photo?'image':msg.audio||msg.voice?'audio':attachmentKind(media.file_name,mime);
 const caption=String(msg.caption||'').split('\n').map(s=>s.replace(/https?:\/\/\S+/g,'').trim()).find(Boolean)||'';
 const date=new Date((Number(msg.date)||Date.now()/1000)*1000).toISOString().replace(/[-:]/g,'').slice(0,15);
 let filename=path.basename(String(photo?'':media.file_name||'').replaceAll('\\','/'));
 if(!filename)filename=`Telegram_${date}_${msg.message_id||'file'}`+(msg.voice?'.ogg':attachmentExtension(mime,kind));
 else if(!/^\.[a-z0-9]{1,16}$/i.test(path.extname(filename)))filename+=attachmentExtension(mime,kind);
 const title=msg.audio?.title||((kind==='video'||kind==='image')?caption:'');
 return validateTelegramAttachment({type:'telegram',fileId:media.file_id,uniqueId:media.file_unique_id,size:media.file_size,
  filename,kind,title:title.slice(0,500),artist:msg.audio?.performer,width:media.width||media.length,height:media.height||media.length,duration:media.duration},options);
}
export function validateTelegramAttachment(raw,{local=false}={}){
 if(!raw||raw.type!=='telegram'||typeof raw.fileId!=='string'||!/^[-\w]{5,512}$/.test(raw.fileId)||typeof raw.uniqueId!=='string'||!/^[-\w]{3,256}$/.test(raw.uniqueId))throw bad('Telegram 附件信息不完整，请重新转发原文件。');
 if(raw.size!==undefined&&(!Number.isSafeInteger(raw.size)||raw.size<1))throw bad('Telegram 文件大小无效');
 if(!local&&raw.size>TELEGRAM_CLOUD_LIMIT)throw bad('这个文件超过 20 MB。当前 Telegram 官方 Bot 接口无法下载，需要先配置自建 Bot API 大文件服务（需要你自己的 api_id / api_hash）。');
 const filename=path.basename(String(raw.filename||'Telegram_file.bin').replaceAll('\\','/')).slice(0,500);
 if(!/^\.[a-z0-9]{1,16}$/i.test(path.extname(filename))||/[\x00-\x1f\x7f]/.test(filename))throw bad('文件名称或扩展名无效');
 // Derive from the filename again on the queue boundary, not a caller's kind claim.
 const kind=attachmentKind(filename);
 const result={type:'telegram',fileId:raw.fileId,uniqueId:raw.uniqueId,filename,kind,title:String(raw.title||'').slice(0,500),artist:String(raw.artist||'').slice(0,200)};
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
 if(raw.botId&&raw.botId!==token.split(':')[0])throw bad('该任务属于之前的 Telegram Bot，请向当前 Bot 重新转发文件。');
 const dispatcher=local?new (runtimeRequire('undici').Agent)({headersTimeout:6*3600000,bodyTimeout:0}):proxy?(makeDispatcher?makeDispatcher(proxy):new (runtimeRequire('undici').ProxyAgent)(proxy)):undefined;
 let cached;const close=async()=>{cached?.close();await dispatcher?.destroy();};
 try{
  const result=await requestTelegramFile(`${telegramApiBase(local)}/bot${token}/getFile`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({file_id:source.fileId,...(local?{_expected_size:source.size}:{})}),dispatcher,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(local?6*3600000:30000)])},{fetchImpl,local});
  const d={result};
  if(!local&&d.result?.file_size>TELEGRAM_CLOUD_LIMIT)throw bad('该文件超过 Telegram 官方 Bot 的 20 MB 下载限制，需要自建 Bot API 大文件服务。');
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
