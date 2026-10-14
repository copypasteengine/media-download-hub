import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {relativePath,safeDirectory} from '../app/storage.mjs';
import {DEFAULT_CATEGORIES,validateCategories} from '../app/categories.mjs';
export const platforms=['bilibili','youtube'];
export function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2),{mode:0o600});const fd=fs.openSync(temp,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);}
export function read(file,fallback=null){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
export function passwordHash(password){if(typeof password!=='string'||password.length<10||password.length>256)throw Error('密码需要 10–256 个字符');const salt=crypto.randomBytes(16).toString('hex');return {salt,hash:crypto.scryptSync(password,salt,32).toString('hex')};}
export function verifyPassword(password,user){if(typeof password!=='string'||password.length>256)return false;const hash=crypto.scryptSync(password,user?.salt||'none',32);return !!user&&user.hash?.length===64&&crypto.timingSafeEqual(hash,Buffer.from(user.hash,'hex'));}
export function cookieInput(platform,input){
 if(!platforms.includes(platform))throw Error('不支持的平台');
 if(typeof input!=='string'||input.length>65536)throw Error('Cookie 内容为空或过大');
 input=input.trim();let pairs=[];
 const domain=platform==='youtube'?'youtube.com':'bilibili.com';
 const accepts=d=>typeof d==='string'&&(d.replace(/^\./,'')===domain||d.endsWith('.'+domain));
 if(input.startsWith('[')||input.startsWith('{')){
  let obj;try{obj=JSON.parse(input);}catch{throw Error('Cookie JSON 格式错误');}
  if(typeof obj.cookie==='string')return cookieInput(platform,obj.cookie);
  const list=Array.isArray(obj)?obj:obj.cookies;
  if(!Array.isArray(list))throw Error('需要 Cookie 数组或 cookie 字段');
  pairs=list.filter(c=>accepts(c.domain)&&(!c.path||c.path==='/')&&(!(c.expirationDate||c.expires)||(c.expirationDate||c.expires)<0||(c.expirationDate||c.expires)>Date.now()/1000)).map(c=>[c.name,c.value]);
 }else if(input.includes('\t')){
  pairs=input.split(/\r?\n/).map(l=>l.replace(/^#HttpOnly_/,'' )).filter(l=>l&&!l.startsWith('#')).map(l=>l.split('\t')).filter(a=>a.length>=7&&accepts(a[0])&&a[2]==='/'&&(Number(a[4])===0||Number(a[4])>Date.now()/1000)).map(a=>[a[5],a[6]]);
 }else{
  if(/[\r\n]/.test(input))throw Error('Cookie 请求头不能包含换行');
  pairs=input.replace(/^Cookie:\s*/i,'').split(';').filter(Boolean).map(part=>{const i=part.indexOf('=');return [part.slice(0,i).trim(),part.slice(i+1).trim()];});
 }
 const map=new Map();for(const [key,value]of pairs){if(!/^[A-Za-z0-9_!#$%&'*+.^`|~-]+$/.test(key)||typeof value!=='string'||/[\r\n;\x00-\x1f\x7f]/.test(value))throw Error('Cookie 含无效字符');map.set(key,value);}
 if(platform==='bilibili'&&!map.get('SESSDATA'))throw Error('缺少 B站 SESSDATA，请导出已登录账号的 Cookie');
 if(platform==='youtube'&&!map.get('SAPISID')&&!map.get('__Secure-3PAPISID'))throw Error('缺少 YouTube 登录 Cookie，请确认已登录');
 return [...map].map(([k,v])=>k+'='+v).join('; ');
}
export const relativeDirectory=relativePath;
export const mediaPath=safeDirectory;
export const apiOrigin='http://cobalt:9000';
export function defaults(){return {version:3,publicUrl:'',urlMode:'auto',categories:structuredClone(DEFAULT_CATEGORIES).map(c=>({...c,volumeId:crypto.randomUUID()})),defaultCategory:'videos',reserveGiB:20,maxFileGiB:50,proxy:{mode:'direct'},telegram:{enabled:false,token:'',local:false,apiId:'',apiHash:'',pairingCode:crypto.randomBytes(24).toString('base64url')},feishu:{enabled:false,appId:'',appSecret:'',pairingCode:crypto.randomBytes(24).toString('base64url')},queueUsername:'bot',queuePassword:crypto.randomBytes(32).toString('base64url')};}
export function publicSettings(s){return {publicUrl:s.publicUrl,urlMode:s.urlMode||'auto',categories:s.categories.map(({id,storageId,name,path,private:privacy,enabled,ready,aliases})=>({id,storageId:storageId||'main',name,path,private:!!privacy,enabled,ready,aliases:aliases||[]})),defaultCategory:s.defaultCategory,reserveGiB:s.reserveGiB,maxFileGiB:s.maxFileGiB,proxy:{mode:s.proxy.mode,configured:!!s.proxy.config},telegram:{enabled:s.telegram.enabled,configured:!!s.telegram.token,local:!!s.telegram.local,apiId:s.telegram.apiId||'',apiHashConfigured:!!s.telegram.apiHash,pairingCode:s.telegram.pairingCode},feishu:{enabled:s.feishu.enabled,appId:s.feishu.appId,configured:!!s.feishu.appSecret,pairingCode:s.feishu.pairingCode}};}
export function updateSettings(old,input){
 const s=structuredClone(old);
 if('urlMode'in input){if(!['auto','manual'].includes(input.urlMode))throw Error('地址模式无效');s.urlMode=input.urlMode;}
 if('publicUrl'in input&&input.publicUrl===''){s.publicUrl='';}else if('publicUrl'in input){let u;try{u=new URL(input.publicUrl);}catch{throw Error('请输入 Cobalt 页面完整地址');}if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('页面地址应如 http://nas.local:9070，不包含路径或密码');s.publicUrl=u.origin;}
 if(s.urlMode==='manual'&&!s.publicUrl)throw Error('手动模式请填写页面地址');
 if(input.categories){s.categories=validateCategories(input.categories,input.defaultCategory||s.defaultCategory,relativeDirectory).map(c=>{const prev=old.categories.find(p=>p.id===c.id);return {...c,ready:prev?.path===c.path&&(prev.storageId||'main')===c.storageId?!!prev.ready:false,volumeId:prev?.volumeId||crypto.randomUUID(),fsType:prev?.path===c.path&&(prev.storageId||'main')===c.storageId?prev.fsType:undefined};});}
 if(input.defaultCategory)s.defaultCategory=input.defaultCategory;
 validateCategories(s.categories,s.defaultCategory,relativeDirectory);
 for(const [k,min,max]of [['reserveGiB',1,4096],['maxFileGiB',1,1024]])if(k in input){const n=Number(input[k]);if(!Number.isFinite(n)||n<min||n>max)throw Error('空间参数超出允许范围');s[k]=n;}
 for(const type of ['telegram','feishu'])if(input[type]){const t=input[type];if(typeof t.enabled==='boolean')s[type].enabled=t.enabled;for(const key of type==='telegram'?['token','apiId','apiHash']:['appId','appSecret'])if(typeof t[key]==='string'&&t[key].trim()){if(t[key].length>256||/[\s\x00-\x1f]/.test(t[key]))throw Error('机器人凭据格式错误');s[type][key]=t[key].trim();}}
 if(typeof input.telegram?.local==='boolean')s.telegram.local=input.telegram.local;
 if(s.telegram.local&&(!/^[1-9]\d{0,9}$/.test(s.telegram.apiId||'')||Number(s.telegram.apiId)>2147483647||!/^[a-f0-9]{32}$/i.test(s.telegram.apiHash||'')))throw Error('大文件服务需要有效的 Telegram API ID 和 API Hash');
 if(s.telegram.enabled&&!/^\d{5,15}:[A-Za-z0-9_-]{20,}$/.test(s.telegram.token))throw Error('Telegram Token 格式不正确');
 if(s.feishu.enabled&&(!/^cli_[a-zA-Z0-9]+$/.test(s.feishu.appId)||!s.feishu.appSecret))throw Error('请填写飞书 App ID 和 App Secret');
 if(input.proxy){if(!['direct','xray'].includes(input.proxy.mode))throw Error('代理模式不支持');s.proxy.mode=input.proxy.mode;if(input.proxy.config){const c=typeof input.proxy.config==='string'?JSON.parse(input.proxy.config):input.proxy.config;if(!Array.isArray(c.outbounds)||!c.outbounds.length)throw Error('Xray 配置需要 outbounds');s.proxy.config=c;s.proxy.source='manual';}if(s.proxy.mode==='xray'&&!s.proxy.config)throw Error('请填写 Xray JSON 配置');}
 return s;
}
export function xrayConfig(s){const c=s.proxy.mode==='xray'?structuredClone(s.proxy.config):{outbounds:[{protocol:'freedom'}]};c.inbounds=[{listen:'0.0.0.0',port:1080,protocol:'http',settings:{}}];c.log={loglevel:'warning'};delete c.api;delete c.stats;return c;}
export function encryptBackup(data,password){if(typeof password!=='string'||password.length<12||password.length>256)throw Error('备份密码至少 12 个字符');const salt=crypto.randomBytes(16),iv=crypto.randomBytes(12),key=crypto.scryptSync(password,salt,32),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);const ciphertext=Buffer.concat([cipher.update(JSON.stringify(data)),cipher.final()]);return {format:'nas-media-downloader/1',salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:ciphertext.toString('base64')};}
export function decryptBackup(data,password){if(data?.format!=='nas-media-downloader/1'||typeof password!=='string'||password.length>256)throw Error('备份格式或密码不正确');try{const key=crypto.scryptSync(password,Buffer.from(data.salt,'base64'),32),decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(data.iv,'base64'));decipher.setAuthTag(Buffer.from(data.tag,'base64'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.data,'base64')),decipher.final()]).toString());}catch{throw Error('备份密码不正确或文件已损坏');}}
