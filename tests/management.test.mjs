import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {cookieInput,defaults,updateSettings,publicSettings,mediaPath,encryptBackup,decryptBackup,passwordHash,verifyPassword} from '../manager/core.mjs';
test('Cookie imports select only platform domain, root path, and unexpired cookies',()=>{
 assert.equal(cookieInput('bilibili','Cookie: SESSDATA=abc; uid=12'),'SESSDATA=abc; uid=12');
 assert.equal(cookieInput('youtube',JSON.stringify([{domain:'.youtube.com',path:'/',name:'SAPISID',value:'yes'},{domain:'.google.com',name:'secret',value:'never'},{domain:'.youtube.com',path:'/',name:'old',value:'no',expires:1}])),'SAPISID=yes');
 assert.equal(cookieInput('bilibili','# Netscape HTTP Cookie File\n#HttpOnly_.bilibili.com\tTRUE\t/\tTRUE\t0\tSESSDATA\tyes'),'SESSDATA=yes');
 assert.throws(()=>cookieInput('youtube','SAPISID=hello\r\nAuthorization: bad'));
 assert.throws(()=>cookieInput('bilibili','other=value'));
});
test('Storage cannot escape mounts, traverse symlinks or overlap private directories',()=>{const s=defaults();for(const p of ['../etc','/etc','a/../../etc','a\\b'])assert.throws(()=>updateSettings(s,{categories:[{...s.categories[0],path:p}]}));assert.throws(()=>updateSettings(s,{categories:[...s.categories,{id:'second',name:'另一分类',path:'Videos/nested'}]}));const temp=fs.mkdtempSync(path.join(os.tmpdir(),'nmd-path-'));try{fs.symlinkSync(os.tmpdir(),temp+'/outside');assert.throws(()=>mediaPath(temp,'outside/secret'));}finally{fs.rmSync(temp,{recursive:true});}});
test('Secrets are omitted from settings response and blank fields retain credentials',()=>{const s=defaults();s.telegram.token='123456:abcdefghijklmnopqrstuvw';s.feishu.appSecret='private';s.proxy={mode:'xray',config:{outbounds:[{protocol:'freedom',password:'private'}]}};const safe=JSON.stringify(publicSettings(s));assert(!safe.includes(s.telegram.token));assert(!safe.includes('"appSecret"'));assert(!safe.includes('"password"'));const n=updateSettings(s,{telegram:{token:''}});assert.equal(n.telegram.token,s.telegram.token);});
test('Backup confidentiality, tamper protection and password verification',()=>{const data={cookie:'sensitive-cookie',states:[]};const backup=encryptBackup(data,'a very long backup password');assert(!JSON.stringify(backup).includes('sensitive-cookie'));assert.deepEqual(decryptBackup(backup,'a very long backup password'),data);assert.throws(()=>decryptBackup(backup,'wrong'));const bad={...backup,tag:Buffer.alloc(16).toString('base64')};assert.throws(()=>decryptBackup(bad,'a very long backup password'));const user=passwordHash('long password');assert(verifyPassword('long password',user));assert(!verifyPassword('bad password',user));});
