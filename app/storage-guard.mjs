import fs from 'node:fs';
import path from 'node:path';

export function volumeIdentity(root){
 if(!fs.lstatSync(root).isDirectory())throw Error('媒体目录不能是符号链接或文件');
 const fd=fs.openSync(path.join(root,'.cobalt-volume'),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const stat=fs.fstatSync(fd);
  if(!stat.isFile()||stat.size<1||stat.size>256)throw Error('媒体盘标识无效');
  return fs.readFileSync(fd,'utf8').trim();
 }finally{fs.closeSync(fd);}
}
export function stagingDirectory(root){
 const staging=path.join(root,'.cobalt-partials');
 try{fs.mkdirSync(staging,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
 if(!fs.lstatSync(staging).isDirectory())throw Error('下载临时目录不能是符号链接或文件');
 return staging;
}
