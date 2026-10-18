import fs from 'node:fs';
import {spawn} from 'node:child_process';

// A Matroska stream written to HTTP cannot seek back to fill Duration/Cues.
// Finish it on the destination disk before publishing it to a media library.
export async function finalizeMedia({file,extension,ffmpeg,signal,reserveBytes=0,maxBytes=Infinity,checkStorage=()=>{}}) {
 const format={'.mkv':'matroska','.webm':'webm'}[extension?.toLowerCase()];
 if(!format)return fs.statSync(file).size;
 if(!ffmpeg)throw new Error('缺少媒体处理组件，无法完成视频封装');
 signal?.throwIfAborted();checkStorage();
 const sourceSize=fs.statSync(file).size, disk=fs.statfsSync(file);
 if(disk.bavail*disk.bsize<reserveBytes+sourceSize*1.02+16*1024**2)throw new Error('空间不足，无法完成媒体封装，请清理空间后重试');
 const output=file+'.indexing';
 fs.rmSync(output,{force:true});
 try {
  await new Promise((resolve,reject)=>{
   let failure,child;
   const stop=error=>{failure??=error;child?.kill('SIGKILL');};
   child=spawn(ffmpeg,['-nostdin','-v','error','-xerror','-i',file,'-map','0','-c','copy','-map_metadata','0','-f',format,'-n',output],{stdio:['ignore','ignore','pipe'],signal});
   child.stderr.resume();
   child.on('error',error=>{failure??=error;});
   let lastSize=0,lastProgress=Date.now();
   const monitor=setInterval(()=>{
    try {
     checkStorage();
     const size=fs.existsSync(output)?fs.statSync(output).size:0;
     if(size>maxBytes)throw new Error('封装后的文件超过单文件大小限制');
     if(size!==lastSize){lastSize=size;lastProgress=Date.now();}
     if(Date.now()-lastProgress>120000)throw new Error('媒体封装超过两分钟没有进展，请检查存储设备后重试');
    }catch(error){stop(error);}
   },5000);
   child.on('close',code=>{
    clearInterval(monitor);
    if(failure)reject(failure);
    else if(code!==0)reject(new Error('媒体封装检查失败，未将文件入库，请重试下载'));
    else resolve();
   });
  });
  signal?.throwIfAborted();checkStorage();
  const size=fs.statSync(output).size;
  if(!size||size>maxBytes)throw new Error('媒体封装结果大小异常，未将文件入库');
  const fd=fs.openSync(output,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(output,file);
  return size;
 }finally{fs.rmSync(output,{force:true});}
}
