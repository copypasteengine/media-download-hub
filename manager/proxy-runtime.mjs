import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {simpleObfs} from './ss-plugin.mjs';
import {nativeClashConfig} from './clash-native.mjs';

export const runtimePath=fileURLToPath(import.meta.url);
// The saved node keeps its real endpoint. Only this private runtime copy is redirected.
export function proxyPlan(input,ports) {
 const config=structuredClone(input),helpers=[];
 for(const out of config.outbounds||[]){
  if(!out._mdhObfs)continue;
  const p=out._mdhObfs;
  const plugin=simpleObfs(p.name,{obfs:p.mode,'obfs-host':p.host??'','obfs-uri':p.uri??'','fast-open':p.fastOpen??false});
  if(!plugin||out.protocol!=='shadowsocks'||out.settings?.servers?.length!==1||out.proxySettings||out.streamSettings?.sockopt?.dialerProxy||!['tcp','raw'].includes(out.streamSettings?.network||'tcp')||!['none',undefined].includes(out.streamSettings?.security))throw Error('SS 混淆不能与其它传输或链式代理叠加');
  const peer=out.settings.servers[0],port=ports[helpers.length];
  if(typeof peer.address!=='string'||!peer.address||/[\s\x00-\x1f\x7f/]/.test(peer.address)||!Number.isInteger(peer.port)||peer.port<1||peer.port>65535||!Number.isInteger(port)||port<1||port>65535)throw Error('SS 混淆端点无效');
  const args=['-s',peer.address,'-p',String(peer.port),'-b','127.0.0.1','-l',String(port),'--obfs',plugin.mode];
  if(plugin.host)args.push('--obfs-host',plugin.host);
  if(plugin.uri)args.push('--obfs-uri',plugin.uri);
  if(plugin.fastOpen)args.push('--fast-open');
  helpers.push({port,args});peer.address='127.0.0.1';peer.port=port;delete out._mdhObfs;
 }
 return {config,helpers};
}
async function freePort(){const s=net.createServer();await new Promise((ok,bad)=>{s.once('error',bad);s.listen(0,'127.0.0.1',ok);});const port=s.address().port;await new Promise(r=>s.close(r));return port;}
async function ready(port){return new Promise(resolve=>{const s=net.connect(port,'127.0.0.1');const done=v=>{s.destroy();resolve(v);};s.setTimeout(100);s.once('connect',()=>done(true));s.once('error',()=>done(false));s.once('timeout',()=>done(false));});}
async function stop(proc){if(!proc.pid||proc.exitCode!==null||proc.signalCode!==null)return;await new Promise(resolve=>{const timer=setTimeout(()=>proc.kill('SIGKILL'),600);proc.once('exit',()=>{clearTimeout(timer);resolve();});proc.kill('SIGTERM');});}

export async function runProxy(filename,{test=false}={}) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mdh-proxy-')),children=[];
 let quitting=false,exitCode=0,finish;
 const finished=new Promise(resolve=>finish=resolve);
 const halt=(code=0)=>{if(quitting)return;quitting=true;exitCode=code;finish();};
 const onSignal=()=>halt(0);process.on('SIGTERM',onSignal);process.on('SIGINT',onSignal);
 const launch=(cmd,args)=>{const proc=spawn(cmd,args,{stdio:'ignore'});children.push(proc);proc.once('error',()=>halt(1));proc.once('exit',code=>halt(test?code??1:1));return proc;};
 try{
  const input=JSON.parse(fs.readFileSync(filename,'utf8'));
  if(input.engine&&!['xray','mihomo'].includes(input.engine))throw Error('不支持的代理内核');
  if(input.engine==='mihomo'){
   fs.writeFileSync(dir+'/mihomo.json',JSON.stringify(nativeClashConfig(input)),{mode:0o600});
   if(!quitting)launch(process.env.MIHOMO_BINARY||'/usr/local/bin/mihomo',[...(test?['-t']:[]),'-d',dir,'-f',dir+'/mihomo.json']);
   await finished;return exitCode;
  }
  const count=(input.outbounds||[]).filter(o=>o._mdhObfs).length;
  if(count>16)throw Error('SS 插件数量超过限制');
  const ports=[];for(let i=0;i<count;i++){let port;do{port=await freePort();}while(ports.includes(port));ports.push(port);}
  const {config,helpers}=proxyPlan(input,ports);
  const obfs=process.env.OBFS_BINARY||'/usr/local/bin/obfs-local';
  if(helpers.length)fs.accessSync(obfs,fs.constants.X_OK);
  fs.writeFileSync(dir+'/xray.json',JSON.stringify(config),{mode:0o600});
  if(!test)for(const helper of helpers){
   if(quitting)break;launch(obfs,helper.args);let listening=false;
   for(let i=0;i<50&&!quitting;i++){if(await ready(helper.port)){listening=true;break;}await delay(50);}
   if(!listening&&!quitting)throw Error('SS 混淆组件启动失败');
  }
  if(!quitting)launch(process.env.XRAY_BINARY||'/usr/local/bin/xray',['run',...(test?['-test']:[]),'-config',dir+'/xray.json']);
  await finished;
 }catch{exitCode=1;console.error('代理启动或校验失败，请检查节点参数与运行组件');}
 finally{quitting=true;await Promise.all(children.map(stop));fs.rmSync(dir,{recursive:true,force:true});process.off('SIGTERM',onSignal);process.off('SIGINT',onSignal);}
 return exitCode;
}
if(process.argv[1]&&path.resolve(process.argv[1])===runtimePath)process.exitCode=await runProxy(process.argv[2],{test:process.argv.includes('--test')});
