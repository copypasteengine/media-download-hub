import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {downloadOptions,downloadError,codecFallback,emptyStreamFallback} from '../app/quality.mjs';
import {jobText} from '../app/telegram-core.mjs';
const source=fs.readFileSync(new URL('../patches/bilibili.js',import.meta.url),'utf8')
 .replace(/^import .*;\n/gm,'');
const {selectVideo}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const video=(width,height,bandwidth)=>({width,height,bandwidth,baseUrl:'https://cdn.example/video'});
test('resolution wins over bandwidth; requested limit and portrait are honored',()=>{
 const formats=[video(854,480,9000),video(1920,1080,3000),video(3840,2160,6000)];
 assert.equal(selectVideo(formats,'max').size,2160);
 assert.equal(selectVideo(formats,'1080').size,1080);
 assert.equal(selectVideo(formats,'720').size,480);
 assert.equal(selectVideo(formats,'360').size,480);
 assert.equal(selectVideo([video(1080,1920,2000)],'1080').size,1080);
 assert.equal(selectVideo([],'max'),undefined);
});
test('higher YouTube qualities choose high-resolution codec without reencoding',()=>{
 for(const quality of ['max','1440','2160'])assert.equal(downloadOptions({quality}).youtubeVideoCodec,'vp9');
 assert.equal(downloadOptions({quality:'1080'}).youtubeVideoCodec,'h264');
 assert.equal(downloadOptions({quality:'max'}).youtubeVideoContainer,'mkv');
});
test('notifications distinguish requested quality from actual resolution',()=>{
 const text=jobText({id:'12345678',url:'https://example.com/video',quality:'1080',state:'completed',mediaInfo:{resolution:'854x480',qualityLabel:'480p'}});
 assert.match(text,/1080p/);assert.match(text,/854x480/);assert.match(text,/480p/);
 assert.match(downloadError('error.api.youtube.login'),/登录/);
});
test('unsupported high-resolution codec falls back; login errors are not retried',()=>{
 const options=downloadOptions({quality:'max'});
 assert.equal(codecFallback(options,{error:{code:'error.api.youtube.no_matching_format'}}).youtubeVideoCodec,'h264');
 assert.equal(codecFallback(options,{error:{code:'error.api.youtube.login'}}),null);
 assert.equal(codecFallback({...options,youtubeVideoCodec:'h264'},{error:{code:'error.api.youtube.no_matching_format'}}),null);
});
test('empty-stream fallback is limited to YouTube VP9/AV1 and retains the requested quality',()=>{
 const job={url:'https://youtu.be/test-video',quality:'max'};
 assert.equal(emptyStreamFallback(job,'vp9').youtubeVideoCodec,'h264');assert.equal(emptyStreamFallback(job,'av1').videoQuality,'max');
 assert.equal(emptyStreamFallback(job,'h264'),null);assert.equal(emptyStreamFallback({...job,sourceType:'telegram'},'vp9'),null);
 assert.equal(emptyStreamFallback({...job,url:'https://youtube.com.evil.example/test'},'vp9'),null);
});
test('Bilibili login is sent only to playback APIs; part and resolution are respected',async()=>{
 const fixture='const env={durationLimit:3600};const readFileSync=()=>JSON.stringify({cookie:"SESSDATA=test-session"});\n'+source;
 const {default:download}=await import('data:text/javascript;base64,'+Buffer.from(fixture).toString('base64'));
 const oldFetch=globalThis.fetch, calls=[];
 globalThis.fetch=async (url,options)=>{
  calls.push({url,options});
  assert.equal(new URL(url).hostname,'api.bilibili.com');
  assert.equal(options.redirect,'error');
  assert.equal(options.headers.cookie,'SESSDATA=test-session');
  if(url.includes('/view?'))return {json:async()=>({code:0,data:{title:'Sample',bvid:'BV123',owner:{name:'Author'},pages:[{page:1,cid:10},{page:2,cid:20,part:'Part 2'}]}})};
  return {json:async()=>({code:0,data:{timelength:1000,dash:{video:[video(640,360,500),video(1920,1080,4000)],audio:[{baseUrl:'https://cdn.example/audio'}]}}})};
 };
 try{
  const result=await download({comId:'BV123',partId:2,quality:'360'});
  assert.match(calls[1].url,/cid=20/);assert.match(calls[1].url,/qn=127/);
  assert.equal(result.filenameAttributes.resolution,'640x360');
  assert.equal(result.fileMetadata.title,'Sample - P2 Part 2');
 }finally{globalThis.fetch=oldFetch;}
});
