import {telegramAttachment} from './telegram-files.mjs';
import {DEFAULT_CATEGORIES,activeCategories} from './categories.mjs';
export const helpText=`视频链接：点击下载分类后发送链接。Telegram 视频附件：直接转发，再点击保存位置。分类名称和保存路径由管理后台配置。

📋 我的下载：查看进度，取消或重试
⚙️ 清晰度：选择之后下载的画质
🔑 登录状态：查看平台登录是否有效
↩️ 返回主菜单：取消本次分类选择

链接分类选择 15 分钟有效，每次最多 5 个链接；直接发送链接使用默认分类。每次转发视频都会询问保存位置，选择前不下载；同一视频相册共用一次选择，保存提示 24 小时有效。菜单更新后请使用新按钮，旧分类不会自动转投其它目录。
Telegram 附件直接保存收到的文件，不重新转码；当前官方 Bot 接口限单个视频 20 MB。较大文件需要自建 Bot API。频道消息链接请改为直接转发视频。
支持 /menu、/download、/status、/cancel、/retry、/quality；分类命令别名由后台配置。支持的平台范围取决于 Cobalt。`;
export function parseMessage(msg,{categories=DEFAULT_CATEGORIES,defaultCategory=categories[0]?.id,local=false}={}){
 const attachment=telegramAttachment(msg,{local});
 if(attachment)return {command:'download',category:defaultCategory,explicitCategory:false,urls:[],attachment};
 const text=String(msg.text||msg.caption||'');
 const m=text.match(/^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
 const command=m?.[1]?.toLowerCase(),argument=(m?.[2]||'').trim();
 const selected=activeCategories(categories).find(c=>(c.aliases||[]).includes(command));
 if(command&&command!=='download'&&!selected)return {command,argument};
 const textLinks=(msg.entities||msg.caption_entities||[]).filter(e=>e.type==='text_link').map(e=>e.url);
 const urls=[...new Set([...textLinks,...(text.match(/https?:\/\/[^\s<>"\u3000]+/g)||[])].map(u=>u.replace(/[。，、；！）】]+$/g,'')))];
 return {command:'download',category:selected?.id||defaultCategory,explicitCategory:!!command,urls:urls.slice(0,5),excess:urls.length>5};
}
export function ownerAllowed(owner,msg){return !!owner&&msg?.chat?.type==='private'&&String(msg.from?.id)===String(owner.userId)&&String(msg.chat.id)===String(owner.chatId)&&!msg.from?.is_bot;}
export function canPair(code,msg){return !msg?.from?.is_bot&&msg?.chat?.type==='private'&&msg.from?.id===msg.chat.id&&parseMessage(msg).command==='start'&&parseMessage(msg).argument===code;}
export const labels={queued:'排队中',resolving:'解析中',downloading:'下载中',checking:'文件检查中',completed:'已保存',failed:'失败',cancelled:'已取消'};
export const bytesText=n=>n>1024**3?(n/1024**3).toFixed(2)+' GiB':(n/1024**2).toFixed(1)+' MiB';
export function jobText(j){const quality=j.mediaInfo?.resolution?`实际画面：${j.mediaInfo.resolution}${j.mediaInfo.qualityLabel?'（'+j.mediaInfo.qualityLabel+'）':''}`:'实际画质：待解析';const name=j.private===true?'私密视频':(j.filename||j.metadata?.title||(j.sourceType==='telegram'?'Telegram 视频':new URL(j.url).hostname));return `#${j.id.slice(0,8)} ${labels[j.state]||j.state}\n${name}\n${j.sourceType==='telegram'?'保存 Telegram 提供的文件，不转码':`选择：${j.quality==='max'?'最高可用':j.quality+'p'}`} · ${quality}\n${bytesText(j.bytes||0)}${j.total?' / '+bytesText(j.total):''}${j.stage&&j.state==='resolving'?'\n'+j.stage:''}${j.error?'\n'+(j.private===true?'下载未完成，可重试或检查媒体盘。':j.error):''}`;}
export function findJob(jobs,prefix){if(!/^[a-f0-9-]{8,36}$/.test(prefix))return null;const matched=jobs.filter(j=>j.id.startsWith(prefix));return matched.length===1?matched[0]:null;}
