import test from 'node:test';
import assert from 'node:assert/strict';
import {createQueueClient} from '../app/queue-client.mjs';
const cfg={queueUrl:'http://queue:9080',queueUsername:'test',queuePassword:'test'};
const response=(code,data,headers={})=>new Response(JSON.stringify(data),{status:code,headers});
test('queue client renews expired session and attaches replacement CSRF token',async()=>{
 let logins=0,jobCalls=0;
 const queue=createQueueClient(cfg,async(url,options)=>{
  if(url.endsWith('/login')){logins++;return response(200,{ok:true},{'set-cookie':'cobalt_queue=s'+logins+'; HttpOnly'});}
  if(url.endsWith('/me'))return response(200,{csrf:'csrf'+logins});
  jobCalls++;
  if(jobCalls===1)return response(401,{error:'expired'});
  assert.equal(options.headers.Cookie,'cobalt_queue=s2');assert.equal(options.headers['X-CSRF-Token'],'csrf2');
  return response(200,{jobs:[]});
 });
 assert.deepEqual(await queue('jobs'),{jobs:[]});assert.equal(logins,2);
});
test('queue rate limiting stays retriable, forbidden operations are permanent',async()=>{
 let status=429;
 const queue=createQueueClient(cfg,async(url)=>url.endsWith('/login')?response(200,{}, {'set-cookie':'cobalt_queue=s'}):url.endsWith('/me')?response(200,{csrf:'csrf'}):response(status,{error:'blocked'}));
 await assert.rejects(queue('jobs'),e=>e.permanent===false);status=403;await assert.rejects(queue('jobs'),e=>e.permanent===true);
});
