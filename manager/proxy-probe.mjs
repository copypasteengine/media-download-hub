import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import net from 'node:net';import {spawn}from'node:child_process';
import {runtimeRequire}from'./dependencies.mjs';import{xrayConfig}from'./core.mjs';
import {runtimePath} from './proxy-runtime.mjs';
const wait=(ms,signal)=>new Promise((resolve,reject)=>{if(signal.aborted)return reject(Error('cancelled'));const abort=()=>{clearTimeout(timer);reject(Error('cancelled'));};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});});
export async function probeNode(node,signal) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nmd-proxy-probe-'));let child,agent,timer;const local=new AbortController(),abort=()=>local.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)local.abort();
 try{
  const server=net.createServer();await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok);});const port=server.address().port;await new Promise(r=>server.close(r));
  const config=xrayConfig({proxy:{mode:'xray',config:node.config}});config.inbounds=[{listen:'127.0.0.1',port,protocol:'http',settings:{}}];
  fs.writeFileSync(dir+'/config.json',JSON.stringify(config),{mode:0o600});
  child=spawn(process.execPath,[runtimePath,dir+'/config.json'],{stdio:'ignore',env:{...process.env,GOMEMLIMIT:'48MiB'}});let exited=false;child.on('exit',()=>exited=true);child.on('error',()=>exited=true);
  timer=setTimeout(()=>local.abort(),14000);
  let ready=false;for(let i=0;i<35;i++){if(exited)throw Error('invalid');await wait(80,local.signal);ready=await new Promise(r=>{const socket=net.connect(port,'127.0.0.1');socket.setTimeout(100);socket.once('connect',()=>{socket.destroy();r(true);});socket.once('error',()=>r(false));socket.once('timeout',()=>{socket.destroy();r(false);});});if(ready)break;}if(!ready)throw Error('invalid');
  const {fetch,ProxyAgent}=runtimeRequire('undici');agent=new ProxyAgent('http://127.0.0.1:'+port);const start=performance.now();
  const response=await fetch('https://www.youtube.com/generate_204',{dispatcher:agent,signal:local.signal,redirect:'error'});await response.body?.cancel();if(![200,204].includes(response.status))throw Error('http');
  return {status:'ok',latencyMs:Math.round(performance.now()-start),checkedAt:new Date().toISOString()};
 }catch(e){return {status:signal?.aborted?'cancelled':'failed',checkedAt:new Date().toISOString(),message:signal?.aborted?'已取消':local.signal.aborted?'连接超时':e.message==='invalid'?'节点配置不兼容':'无法通过节点访问检测地址'};}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(agent)await agent.destroy().catch(()=>{});if(child&&child.exitCode===null){const proc=child;await new Promise(resolve=>{const kill=setTimeout(()=>{proc.kill('SIGKILL');resolve();},1000);proc.once('exit',()=>{clearTimeout(kill);resolve();});proc.kill('SIGTERM');});}fs.rmSync(dir,{recursive:true,force:true});}
}
