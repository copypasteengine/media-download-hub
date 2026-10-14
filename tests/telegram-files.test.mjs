import test from 'node:test';
import assert from 'node:assert/strict';
import {telegramAttachment,validateTelegramAttachment,telegramFilePath,openTelegramFile,attachmentCategory,TELEGRAM_CLOUD_LIMIT,telegramPostLink} from '../app/telegram-files.mjs';
import {parseMessage,jobText} from '../app/telegram-core.mjs';
const media={file_id:'file_123456',file_unique_id:'unique_123',file_name:'recording.mp4',file_size:1024,width:1920,height:1080};
const token='123456789:abcdefghijklmnopqrstuvwxyz';
const signal=()=>new AbortController().signal;
test('forwarded video takes precedence over caption URLs or commands and preserves original quality metadata',()=>{
 const msg={video:media,caption:'旅途回忆\nhttps://example.com/ad',forward_origin:{type:'channel'},message_id:3,date:1700000000};
 const parsed=parseMessage(msg);assert.equal(parsed.attachment.title,'旅途回忆');assert.deepEqual(parsed.urls,[]);assert.equal(parsed.attachment.width,1920);
 assert.equal(parseMessage({...msg,caption:'/cancel 12345678'}).command,'download');
 assert.equal(telegramAttachment({document:{...media,file_name:'clip.MKV'}}).filename,'clip.MKV');
 assert(telegramAttachment({video_note:{...media,length:320}}).filename.endsWith('.mp4'));
 assert.throws(()=>telegramAttachment({document:{...media,file_name:'notes.pdf',mime_type:'application/pdf'}}),/不是支持的视频/);
 assert.throws(()=>telegramAttachment({video:{...media,file_size:TELEGRAM_CLOUD_LIMIT+1}}),/20 MB/);
 assert.throws(()=>validateTelegramAttachment({...telegramAttachment(msg),fileId:'../../secret'}),/信息不完整/);
});
test('video album keeps first selected category after prompts clear and across state reload',async()=>{
 let state={},category='private',saves=0;
 const deps=()=>({state,resolve:async()=>category,save:()=>saves++});const p={attachment:{}};
 assert.equal(await attachmentCategory({media_group_id:'album1'},p,deps()),'private');
 state=JSON.parse(JSON.stringify(state));category='normal';
 assert.equal(await attachmentCategory({media_group_id:'album1'},p,deps()),'private');
 assert.equal(await attachmentCategory({media_group_id:'album2'},p,deps()),'normal');
 assert.equal(await attachmentCategory({},p,deps()),'normal');assert.equal(saves,2);
});
test('file transfer requests fresh Telegram file path through dedicated proxy without returning token URL',async()=>{
 const source=telegramAttachment({video:media});const calls=[];let destroyed=0;
 const d={destroy:async()=>destroyed++};
 const result=await openTelegramFile(source,{token,proxy:'http://proxy:1080',signal:signal(),makeDispatcher:()=>d,fetchImpl:async(url,options)=>{
  calls.push(url);assert.equal(options.dispatcher,d);assert.equal(options.redirect,'error');
  return url.endsWith('/getFile')?Response.json({ok:true,result:{file_path:'videos/file_1.mp4',file_size:4}}):new Response('data',{'headers':{'content-type':'video/mp4'}});
 }});
 assert.equal(await result.response.text(),'data');assert.equal(result.size,4);assert.equal(calls.length,2);assert.equal('url' in result,false);await result.close();assert.equal(destroyed,1);
 for(const invalid of ['/etc/passwd','../secret','videos/../../secret','https://evil.example/file','videos/%2e%2e/file','videos//file'])assert.throws(()=>telegramFilePath(invalid));
});
test('download failures are actionable and cannot expose token or unsafe paths',async()=>{
 const source=telegramAttachment({video:media});
 await assert.rejects(()=>openTelegramFile({...source,botId:'999999'},{token,signal:signal()}),/之前的 Telegram Bot/);
 await assert.rejects(()=>openTelegramFile(source,{token,signal:signal(),fetchImpl:async()=>{throw Error('URL contains '+token);}}),e=>!e.message.includes(token)&&e.message.includes('获取失败'));
 await assert.rejects(()=>openTelegramFile(source,{token,signal:signal(),fetchImpl:async()=>Response.json({ok:false,description:'Bad Request: file is too big'},{status:400})}),/20 MB/);
 await assert.rejects(()=>openTelegramFile(source,{token,signal:signal(),fetchImpl:async()=>Response.json({ok:true,result:{file_path:'../secret'}})}),/无效文件路径/);
 assert(telegramPostLink('https://t.me/example/123'));assert(!telegramPostLink('https://t.me.evil.example/123'));
 const text=jobText({id:'abcd1234',state:'queued',sourceType:'telegram',quality:'original',url:'https://t.me/',bytes:0});assert(text.includes('不转码'));assert(!text.includes('originalp'));
});
