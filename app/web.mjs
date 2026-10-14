import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {read,apiOrigin} from '../manager/core.mjs';
import {clientOrigin,rewriteDownloadUrls} from './public-routing.mjs';
const root='/project/vendor/web';
function proxy(req,res,prefix=''){const url=req.url.slice(prefix.length)||'/';const out=http.request({hostname:'cobalt',port:9000,path:url,method:req.method,headers:{...req.headers,host:'cobalt:9000','accept-encoding':'identity','x-forwarded-for':req.socket.remoteAddress}},r=>{if((r.headers['content-type']||'').includes('application/json')){let size=0,chunks=[];r.on('data',b=>{size+=b.length;if(size>2*1024**2){r.destroy();res.destroy();}else chunks.push(b);});r.on('end',()=>{const s=read('/config/settings.json'),origin=clientOrigin(req.headers.host,req.headers['x-forwarded-proto']);let text=Buffer.concat(chunks).toString();text=rewriteDownloadUrls(text,apiOrigin,origin,prefix);const headers={...r.headers,'content-length':Buffer.byteLength(text)};delete headers['transfer-encoding'];res.writeHead(r.statusCode,headers);res.end(text);});}else{res.writeHead(r.statusCode,r.headers);r.pipe(res);}});out.setTimeout(300000,()=>out.destroy());out.on('error',()=>{if(!res.headersSent)res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'API starting'}));});req.on('aborted',()=>out.destroy());res.on('close',()=>out.destroy());req.pipe(out);}
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.ico':'image/x-icon','.webp':'image/webp','.txt':'text/plain'};
http.createServer((req,res)=>{try{
 if(!/^[A-Za-z0-9.\[\]:_-]+$/.test(req.headers.host||'')){res.writeHead(400);res.end();return;}
 if(req.url==='/healthz'){res.end('ok');return;}
 if(req.url==='/api'||req.url.startsWith('/api/'))return proxy(req,res,'/api');
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
 const pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);let target=path.resolve(root,'.'+pathname);if(!target.startsWith(root+'/')&&target!==root){res.writeHead(403);res.end();return;}
 if(fs.existsSync(target)&&fs.statSync(target).isDirectory())target=path.join(target,'index.html');
 if(!fs.existsSync(target)&&fs.existsSync(target+'.html'))target+='.html';
 if(!fs.existsSync(target)){res.writeHead(404);res.end();return;}
 const headers={'Content-Type':types[path.extname(target)]||'application/octet-stream','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','X-Content-Type-Options':'nosniff','Cache-Control':target.endsWith('.js')?'no-cache':'public, max-age=3600'};
 if(target.endsWith('.js')&&fs.statSync(target).size<2000000){const s=read('/config/settings.json');const source=fs.readFileSync(target,'utf8').replaceAll('__NMD_API_ORIGIN__',clientOrigin(req.headers.host,req.headers['x-forwarded-proto'])+'/api/');res.writeHead(200,{...headers,'Content-Length':Buffer.byteLength(source)});res.end(req.method==='HEAD'?undefined:source);return;}
 res.writeHead(200,{...headers,'Content-Length':fs.statSync(target).size});if(req.method==='HEAD')res.end();else fs.createReadStream(target).pipe(res);
 }catch{if(!res.headersSent)res.writeHead(400);res.end();}}).listen(8080,'0.0.0.0');
http.createServer((req,res)=>{try{clientOrigin(req.headers.host,req.headers['x-forwarded-proto']);proxy(req,res);}catch{res.writeHead(400);res.end();}}).listen(8081,'0.0.0.0');
