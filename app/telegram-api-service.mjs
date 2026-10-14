// Internal-only gateway and supervisor. No host networking, TUN or Docker socket.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {lookup} from 'node:dns/promises';
import {spawn} from 'node:child_process';
const root='/telegram-data',config='/config/settings.json';
const read=(p,fallback=null)=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return fallback;}};
let child,signature='',busy=false,stopping=false,active=null,retryAt=0,state='starting',settings;
function status(value){state=value;try{const p='/status/telegram-api.json';fs.writeFileSync(p+'.new',JSON.stringify({role:'telegram-api',state,updatedAt:new Date().toISOString()}),{mode:0o600});fs.renameSync(p+'.new',p);}catch{}}
function prune(all=false){
 const walk=p=>{for(const e of fs.readdirSync(p,{withFileTypes:true})){const f=path.join(p,e.name);if(e.isSymbolicLink())continue;if(e.isDirectory())walk(f);else if(e.isFile()&&(all||Date.now()-fs.statSync(f).mtimeMs>86400000))fs.unlinkSync(f);}};
 if(fs.existsSync(root+'/files'))walk(root+'/files');
}
async function stop(){
 if(!child)return;const p=child;child=null;
 await new Promise(resolve=>{const t=setTimeout(()=>p.kill('SIGKILL'),5000);p.once('exit',()=>{clearTimeout(t);resolve();});p.kill('SIGTERM');});
}
async function reset(){await stop();prune(true);retryAt=Date.now()+1000;}
async function tick(){
 if(busy||stopping)return;busy=true;
 try{
  settings=read(config);const t=settings?.telegram;
  if(fs.existsSync('/config/maintenance')){await stop();status('maintenance');return;}
  // Keep an already configured server available during local -> cloud logout.
  if(!t?.apiId||!t?.apiHash||!t.token){await stop();status('disabled');return;}
  const sig=JSON.stringify([t.apiId,t.apiHash,t.token]);
  if(sig!==signature){await stop();signature=sig;retryAt=0;}
  if(!child&&Date.now()>retryAt){
   for(const d of ['db','files','temp'])fs.mkdirSync(root+'/'+d,{recursive:true,mode:0o700});
   prune();
   const proxy=await lookup('proxy',{family:4});
   fs.writeFileSync('/tmp/proxychains.conf',`strict_chain\nquiet_mode\nproxy_dns\ntcp_read_time_out 15000\ntcp_connect_time_out 10000\nlocalnet 127.0.0.0/255.0.0.0\n[ProxyList]\nhttp ${proxy.address} 1080\n`,{mode:0o600});
   child=spawn('proxychains4',['-q','-f','/tmp/proxychains.conf','/usr/local/bin/telegram-bot-api','--local','--http-ip-address=127.0.0.1','--http-port=8082',`--dir=${root}/db`,`--files-dir=${root}/files`,`--temp-dir=${root}/temp`,'--verbosity=0','--memory-verbosity=0','--max-connections=256'],{env:{...process.env,TELEGRAM_API_ID:String(t.apiId),TELEGRAM_API_HASH:t.apiHash},stdio:'ignore'});
   const p=child;p.on('error',()=>{});p.once('exit',()=>{if(child===p)child=null;retryAt=Date.now()+10000;});
  }
  if(child){const f=fs.statfsSync(root);if(f.bavail*f.bsize<(settings.reserveGiB||20)*1024**3){await reset();status('disk-full');return;}}
  status(child?(active?'downloading':'running'):'retrying');
 }catch{status('configuration-error');}finally{busy=false;}
}
const json=(res,code,data)=>{if(!res.destroyed){res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));}};
const allowed=new Set(['getMe','getUpdates','getWebhookInfo','setMyCommands','sendMessage','editMessageText','editMessageReplyMarkup','answerCallbackQuery','getFile','logOut','close']);
const server=http.createServer(async(req,res)=>{
 if(req.url==='/healthz')return json(res,200,{ok:true,state});
 const t=read(config)?.telegram,match=req.url?.match(/^\/bot([^/]+)\/([A-Za-z]+)$/);
 if(req.method!=='POST'||!t?.token||match?.[1]!==t.token||!allowed.has(match[2]))return json(res,404,{ok:false,error_code:404});
 if(!child||['maintenance','disk-full'].includes(state))return json(res,503,{ok:false,error_code:503});
 const method=match[2],abort=new AbortController();let download=false,done=false;
 try{
  let raw='';for await(const b of req){raw+=b;if(raw.length>65536)throw Error();}const data=JSON.parse(raw||'{}');
  if(method==='getFile'){
   if(active)return json(res,409,{ok:false,error_code:409});
   const route=read('/status/telegram-route.json');if(route?.mode!=='local'||route.botId!==t.token.split(':')[0])return json(res,503,{ok:false,error_code:503});
   const size=data._expected_size,s=read(config),f=fs.statfsSync(root);
   if(!Number.isSafeInteger(size)||size<=0||size>s.maxFileGiB*1024**3||f.bavail*f.bsize-size<s.reserveGiB*1024**3)return json(res,413,{ok:false,error_code:413});
   delete data._expected_size;active=abort;download=true;
  }
  res.once('close',()=>{if(!done)abort.abort();});
  // Native HTTP has no fetch/undici five-minute headers timeout: getFile may
  // wait for the whole Telegram download before returning a local path.
  const r=await new Promise((resolve,reject)=>{
   const upstream=http.request({hostname:'127.0.0.1',port:8082,path:`/bot${t.token}/${method}`,method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.any([abort.signal,AbortSignal.timeout(download?6*3600000:60000)])},response=>{
    let body='';response.on('data',b=>{body+=b;if(body.length>8*1024**2)upstream.destroy();});response.on('error',reject);response.on('end',()=>{try{resolve({status:response.statusCode,data:JSON.parse(body)});}catch{reject(Error());}});
   });upstream.on('error',reject);upstream.end(JSON.stringify(data));
  });
  done=true;json(res,r.status,r.data);
 }catch{if(download){await reset();}done=true;json(res,502,{ok:false,error_code:502,description:'Local Telegram API unavailable'});}
 finally{if(download&&active===abort)active=null;}
});
server.requestTimeout=15000;server.headersTimeout=10000;
server.listen(8081,'0.0.0.0');setInterval(tick,2500);void tick();
setInterval(()=>{if(!active)try{prune();}catch{}},3600000).unref();
process.on('SIGTERM',async()=>{stopping=true;server.close();active?.abort();await stop();process.exit(0);});
