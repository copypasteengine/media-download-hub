import crypto from 'node:crypto';
import https from 'node:https';
import http from 'node:http';
import dns from 'node:dns/promises';
import net from 'node:net';
import {runtimeRequire} from './dependencies.mjs';
import {parsePluginOptions,simpleObfs} from './ss-plugin.mjs';
import {nativeClashNode} from './clash-native.mjs';
const YAML=runtimeRequire('yaml');
const MAX_BYTES=2*1024*1024;
const decode=s=>Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8');
const clean=s=>String(s||'').slice(0,160);
function transport(p={}) {
 const network=p.network||'tcp';if(!['tcp','raw','ws','grpc','httpupgrade'].includes(network))throw Error('不支持的传输方式 '+network);
 const t={network,security:p.security||'none'};
 if(!['none','tls','reality'].includes(t.security))throw Error('不支持的 TLS 类型');
 if(network==='ws')t.wsSettings={path:p.path||'/',headers:p.host?{Host:p.host}:{}};
 if(network==='grpc')t.grpcSettings={serviceName:p.serviceName||''};
 if(network==='httpupgrade')t.httpupgradeSettings={path:p.path||'/',host:p.host||''};
 if(t.security==='tls')t.tlsSettings={serverName:p.sni||'',fingerprint:p.fp||'chrome',allowInsecure:!!p.insecure,...(p.alpn?{alpn:Array.isArray(p.alpn)?p.alpn:p.alpn.split(',')}:{})};
 if(t.security==='reality') {if(!p.pbk)throw Error('REALITY 缺少公钥');t.realitySettings={serverName:p.sni||'',fingerprint:p.fp||'chrome',publicKey:p.pbk,shortId:p.sid||'',spiderX:p.spx||'/'};}
 return t;
}
function node(p) {
 const port=Number(p.port);if(!p.host||/[\s/]/.test(p.host)||!Number.isInteger(port)||port<1||port>65535)throw Error('节点地址或端口无效');
 const out={tag:'proxy',protocol:p.type};
 if(['vless','vmess'].includes(p.type)) {
  if(!p.uuid)throw Error('缺少 UUID');
  out.settings={vnext:[{address:p.host,port,users:[p.type==='vless'?{id:p.uuid,encryption:'none',...(p.flow?{flow:p.flow}:{})}:{id:p.uuid,alterId:Number(p.alterId||0),security:p.cipher||'auto'}]}]};
 } else if(p.type==='trojan') {if(!p.password)throw Error('缺少密码');out.settings={servers:[{address:p.host,port,password:p.password}]};}
 else if(p.type==='shadowsocks') {if(!p.password||!p.cipher)throw Error('缺少加密方式或密码');out.settings={servers:[{address:p.host,port,method:p.cipher,password:p.password}]};}
 else if(['http','socks'].includes(p.type))out.settings={servers:[{address:p.host,port,...(p.username?{users:[{user:p.username,pass:p.password||''}]}:{})}]};
 else throw Error('不支持的节点协议 '+p.type);
 out.streamSettings=transport(p.transport||{});
 if(p.plugin)out._mdhObfs=p.plugin;
 return {name:clean(p.name)||p.type+' · '+p.host,protocol:p.type,server:p.host,port,config:{outbounds:[out]}};
}
function uri(line) {
 const labelled=line.match(/^[^:\r\n]{1,160}:\s+(ss:\/\/\S+)$/);if(labelled)line=labelled[1];
 if(line.startsWith('vmess://')) {const v=JSON.parse(decode(line.slice(8)));if(v.type&&v.type!=='none')throw Error('不支持 VMess header type');return node({type:'vmess',name:v.ps,host:v.add,port:v.port,uuid:v.id,alterId:v.aid,cipher:v.scy,transport:{network:v.net||'tcp',security:v.tls||'none',sni:v.sni||v.host,host:v.host,path:v.path,serviceName:v.path,fp:v.fp,alpn:v.alpn}});}
 if(line.startsWith('ss://')) {
  let raw=line.slice(5),hash=raw.indexOf('#'),name=hash<0?'':decodeURIComponent(raw.slice(hash+1));if(hash>=0)raw=raw.slice(0,hash);
  const query=raw.indexOf('?'),params=new URLSearchParams(query<0?'':raw.slice(query+1));if(query>=0)raw=raw.slice(0,query);
  if(params.getAll('plugin').length>1)throw Error('SS 插件参数重复');
  const pluginSpec=parsePluginOptions(params.get('plugin')||''),plugin=simpleObfs(pluginSpec.name,pluginSpec.options);
  if(!raw.includes('@'))raw=decode(raw);
  const index=raw.lastIndexOf('@');if(index<0)throw Error('SS 链接无效');let auth=raw.slice(0,index);if(!auth.includes(':'))auth=decode(auth);const colon=auth.indexOf(':');const host=new URL('http://'+raw.slice(index+1));
  if(colon<1)throw Error('SS 加密方式或密码无效');
  return node({type:'shadowsocks',name,plugin,host:host.hostname.replace(/^\[|\]$/g,''),port:host.port,cipher:decodeURIComponent(auth.slice(0,colon)),password:decodeURIComponent(auth.slice(colon+1))});
 }
 const u=new URL(line),type=u.protocol.slice(0,-1),p=u.searchParams;
 if(!['vless','trojan','socks','http','https'].includes(type))throw Error('不支持的节点协议 '+type);
 if(p.get('encryption')&&!['none','auto'].includes(p.get('encryption')))throw Error('暂不支持该 VLESS encryption');
 return node({type:type==='https'?'http':type,name:decodeURIComponent(u.hash.slice(1)),host:u.hostname.replace(/^\[|\]$/g,''),port:u.port||(type==='https'?443:type==='http'?80:0),uuid:decodeURIComponent(u.username),password:decodeURIComponent(type==='trojan'?u.username:u.password),username:decodeURIComponent(u.username),flow:p.get('flow'),transport:{network:p.get('type')||'tcp',security:p.get('security')||(type==='trojan'||type==='https'?'tls':'none'),sni:p.get('sni'),fp:p.get('fp'),pbk:p.get('pbk'),sid:p.get('sid'),spx:p.get('spx'),path:p.get('path'),host:p.get('host'),serviceName:p.get('serviceName'),alpn:p.get('alpn'),insecure:['1','true'].includes(p.get('allowInsecure'))}});
}
function clash(v) {
 if(['anytls','hysteria2'].includes(v.type)||v.type==='vless'&&(v.network==='xhttp'||v['ech-opts']||v.encryption&&v.encryption!=='none')){
  const {node,port}=nativeClashNode(v);return {name:clean(v.name)||v.type+' · '+v.server,protocol:v.type,server:v.server,port,config:{engine:'mihomo',node}};
 }
 if(v['dialer-proxy'])throw Error('暂不支持链式代理');
 if(v.plugin&&v.type!=='ss')throw Error('只有 SS 节点支持混淆插件');
 const plugin=simpleObfs(v.plugin,v['plugin-opts']||{});
 const reality=v['reality-opts'];return node({plugin,type:v.type==='ss'?'shadowsocks':v.type==='socks5'?'socks':v.type,name:v.name,host:v.server,port:v.port,uuid:v.uuid,password:v.password,username:v.username,cipher:v.cipher,alterId:v.alterId,flow:v.flow,transport:{network:v.network||'tcp',security:reality?'reality':v.tls||v.type==='trojan'?'tls':'none',sni:v.servername||v.sni,fp:v['client-fingerprint'],pbk:reality?.['public-key'],sid:reality?.['short-id'],path:v['ws-opts']?.path||v['http-upgrade-opts']?.path,host:v['ws-opts']?.headers?.Host||v['http-upgrade-opts']?.host,serviceName:v['grpc-opts']?.['grpc-service-name'],insecure:v['skip-cert-verify'],alpn:v.alpn}});
}
export function parseSubscription(input) {
 if(typeof input!=='string'||!input.trim()||Buffer.byteLength(input)>MAX_BYTES)throw Error('订阅为空或超过 2 MiB');
 let text=input.trim();if(/^[A-Za-z0-9+/_=\s-]+$/.test(text)&&!text.includes('://'))text=decode(text.replace(/\s/g,''));
 let entries,parser;
 if(/^\s*(?:proxies\s*:|\{|\[|#)/.test(text)||/\nproxies\s*:/.test(text)) {
  let data;try{data=YAML.parse(text,{maxAliasCount:30,uniqueKeys:true});}catch{throw Error('JSON / YAML 订阅格式无效');}
  if(Array.isArray(data?.proxies)){entries=data.proxies;parser=clash;}
  else if(Array.isArray(data?.outbounds)){entries=[data];parser=c=>{const o=c.outbounds.find(o=>!['freedom','blackhole','dns'].includes(o.protocol));if(!o)throw Error('没有代理出站');const peer=o.settings?.vnext?.[0]||o.settings?.servers?.[0];return {name:clean(o.tag)||'Xray 配置',protocol:o.protocol,server:peer?.address||'',port:peer?.port,config:c};};}
  else throw Error('支持 Clash proxies 或 Xray outbounds 格式');
 }else{entries=text.split(/\r?\n/).map(s=>s.trim()).filter(s=>s&&!s.startsWith('#'));parser=uri;}
 if(entries.length>500)throw Error('订阅节点超过 500 个');
 const nodes=[],warnings=[];
 for(let i=0;i<entries.length;i++){try{const v=parser(entries[i]);v.id=crypto.createHash('sha256').update(JSON.stringify(v.config)).digest('hex').slice(0,20);if(!nodes.some(n=>n.id===v.id))nodes.push(v);}catch(e){warnings.push('第 '+(i+1)+' 项：'+String(e.message).replace(/(?:[a-z]+:\/\/)[^\s]+/gi,'[链接]').slice(0,120));}}
 if(!nodes.length)throw Error('未找到支持的节点。'+warnings.slice(0,3).join('；'));
 return {nodes,warnings};
}
export function publicAddress(address) {
 if(net.isIP(address)===4){const [a,b]=address.split('.').map(Number);return !(a===0||a===10||a===127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a>=224||a===198&&[18,19].includes(b));}
 if(net.isIP(address)===6){const a=address.toLowerCase();return /^[23]/.test(a)&&!a.startsWith('2001:db8')&&!a.startsWith('2002:');}
 return false;
}
export async function fetchSubscription(url,depth=0) {
 const u=new URL(url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||depth>4||u.href.length>4096)throw Error('订阅地址无效');
 const host=u.hostname.replace(/^\[|\]$/g,'');const addresses=net.isIP(host)?[{address:host,family:net.isIP(host)}]:await dns.lookup(host,{all:true});
 if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw Error('订阅地址必须为公网地址');
 const a=addresses[0];
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>req.destroy(Error('订阅请求超时')),20000);
  const req=(u.protocol==='https:'?https:http).get(u,{headers:{'User-Agent':'Media-Download-Hub/1.3','Accept':'text/plain, application/yaml, application/json'},lookup:(_host,opts,cb)=>cb(null,opts.all?[a]:a.address,a.family)},res=>{
   if([301,302,303,307,308].includes(res.statusCode)){res.resume();clearTimeout(timer);fetchSubscription(new URL(res.headers.location,u).href,depth+1).then(resolve,reject);return;}
   if(res.statusCode!==200){res.resume();clearTimeout(timer);reject(Error('订阅服务器返回 HTTP '+res.statusCode));return;}
   let size=0;const chunks=[];res.on('data',b=>{size+=b.length;if(size>MAX_BYTES)res.destroy(Error('订阅超过 2 MiB'));else chunks.push(b);});res.on('error',e=>{clearTimeout(timer);reject(e);});res.on('end',()=>{clearTimeout(timer);resolve(Buffer.concat(chunks).toString('utf8'));});
  });req.on('error',()=>{clearTimeout(timer);reject(Error('订阅获取失败，请检查地址或上传订阅文件'));});
 });
}
