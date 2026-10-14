import test from 'node:test';
import assert from 'node:assert/strict';
import {createTelegramTransport} from '../app/telegram-transport.mjs';
test('failed proxy pool is replaced and the failed send is not automatically replayed',async()=>{
 const pools=[],failures=[];let calls=0;
 const t=createTelegramTransport({token:'not-a-real-token',signal:new AbortController().signal,makeProxy:()=>{const p={destroyed:false,destroy(){this.destroyed=true;}};pools.push(p);return p;},onFailure:d=>failures.push(d),fetchImpl:async(url,options)=>{calls++;if(calls===1)throw Object.assign(new TypeError('fetch failed'),{cause:{code:'UND_ERR_CONNECT_TIMEOUT'}});assert.equal(options.dispatcher,pools[1]);return {ok:true,json:async()=>({ok:true,result:{id:1}})};}});
 await assert.rejects(t.request('sendMessage',{}));assert.equal(calls,1);assert.equal(pools[0].destroyed,true);assert.equal(pools.length,2);assert.equal(failures[0].cause,'UND_ERR_CONNECT_TIMEOUT');assert.deepEqual(await t.request('getMe'),{id:1});await t.close();
});
test('Telegram rate limits retain retryAfter and do not recycle the connection',async()=>{
 let created=0;const t=createTelegramTransport({token:'test',signal:new AbortController().signal,makeProxy:()=>{created++;return {destroy(){}};},fetchImpl:async()=>({ok:false,status:429,json:async()=>({ok:false,error_code:429,parameters:{retry_after:7}})})});
 await assert.rejects(t.request('getMe'),e=>e.retryAfter===7);assert.equal(created,1);await t.close();
});
