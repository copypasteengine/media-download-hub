import path from 'node:path';
import fs from 'node:fs';
const characterMap={'<':'＜','>':'＞',':':'：','"':'＂','/':'／','\\':'＼','|':'｜','?':'？','*':'＊'};
export function cleanLabel(value){return String(value||'').normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f]/g,'').replace(/[<>:"/\\|?*]/g,c=>characterMap[c]).replace(/\s+/g,' ').replace(/^\.+/,'').replace(/[. ]+$/,'').trim();}
function fit(text,budget){let out='';for(const c of text){if(Buffer.byteLength(out+c)>budget)break;out+=c;}return out.trim();}
export function mediaFilename(original,metadata={},suffix=''){
 const extension=path.extname(String(original)).toLowerCase();
 if(!/^\.[a-z0-9]{2,5}$/.test(extension))throw Error('Invalid media extension');
 const title=cleanLabel(typeof metadata.title==='string'?metadata.title:''),artist=cleanLabel(typeof metadata.artist==='string'?metadata.artist:'');
 let stem=title?(title+(artist&&artist!==title?' - '+artist:'')):cleanLabel(path.basename(String(original).replaceAll('\\','/'),path.extname(String(original))));
 if(!stem)stem='video';
 return fit(stem,240-Buffer.byteLength(extension+suffix))+suffix+extension;
}
export function availableFilename(root,original,metadata,id){
 for(let n=0;n<10000;n++){
  const suffix=n===0?'':` [${id.slice(0,8)}${n>1?'-'+n:''}]`;
  const filename=mediaFilename(original,metadata,suffix);
  if(!fs.existsSync(path.join(root,filename)))return filename;
 }
 throw Error('无法分配不重复的文件名');
}
export function alreadyPublished(job){
 if(!job.target||!job.publishing)return false;
 try{const st=fs.statSync(job.target);return st.ino===job.publishing.ino&&st.dev===job.publishing.dev&&st.size===job.publishing.size&&st.size>0;}catch{return false;}
}
// Hard-link the finished temporary file atomically, refusing to overwrite an existing name.
export function publishFile(job,root,persist){
 const st=fs.statSync(job.partial);job.publishing={dev:st.dev,ino:st.ino,size:st.size};persist();
 for(let attempt=0;attempt<10000;attempt++){
  try{fs.linkSync(job.partial,job.target);fs.unlinkSync(job.partial);return;}
  catch(e){if(e.code!=='EEXIST')throw e;job.filename=availableFilename(root,job.originalFilename,job.metadata,job.id);job.target=path.join(root,job.filename);persist();}
 }
 throw Error('发布文件时遇到过多同名冲突');
}
