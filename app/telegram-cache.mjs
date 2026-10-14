import fs from 'node:fs';
import path from 'node:path';
// Local getFile returns an absolute path containing the bot token. Never expose it.
export function openCachedTelegramFile(file,root,token){
 const base=path.join(root,'files',token);
 if(typeof file!=='string'||!path.isAbsolute(file)||file.includes('\0')||path.normalize(file)!==file||!file.startsWith(base+'/'))throw Error('Telegram 缓存文件路径无效');
 const realBase=fs.realpathSync(base),real=fs.realpathSync(file);
 if(realBase!==base||real!==file)throw Error('Telegram 缓存路径不能包含符号链接');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 const st=fs.fstatSync(fd);
 if(!st.isFile()||st.nlink!==1){fs.closeSync(fd);throw Error('Telegram 缓存不是普通文件');}
 let closed=false;
 return {fd,size:st.size,close(){if(closed)return;closed=true;try{fs.closeSync(fd);}catch{}try{const cur=fs.lstatSync(file);if(cur.dev===st.dev&&cur.ino===st.ino)fs.unlinkSync(file);}catch{}}};
}
