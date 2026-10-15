import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {readRangeChunks} from '../patches/range-stream.js';

const info=()=>({url:'https://cdn.example/media',service:'youtube',controller:new AbortController()});
const collect=async iterable=>{const chunks=[];for await(const chunk of iterable)chunks.push(chunk);return Buffer.concat(chunks);};
test('discarding rejected Undici-style bodies handles their asynchronous abort errors',async()=>{
 const request=async()=>({statusCode:403,headers:{},body:new Readable({read(){},destroy(_error,callback){callback(Object.assign(new Error('Request aborted'),{code:'UND_ERR_ABORTED'}));}})});
 await assert.rejects(collect(readRangeChunks(info(),2000000n,{request,getHeaders:()=>({})})));
 await new Promise(resolve=>setImmediate(resolve));
});
test('YouTube 403 shrinks only the rejected chunk and downloads every byte exactly once',async()=>{
 const payload=Buffer.alloc(2400000);for(let i=0;i<payload.length;i++)payload[i]=i%251;
 const ranges=[],resizes=[];
 const request=async(_url,{headers})=>{
  const [,first,last]=/bytes=(\d+)-(\d+)/.exec(headers.Range),start=Number(first),end=Number(last);ranges.push([start,end]);
  if(end-start+1>524288)return {statusCode:403,headers:{'content-length':'0'},body:Readable.from([])};
  return {statusCode:206,headers:{'content-range':`bytes ${start}-${end}/${payload.length}`,'content-length':String(end-start+1)},body:Readable.from([payload.subarray(start,end+1)])};
 };
 assert.deepEqual(await collect(readRangeChunks(info(),BigInt(payload.length),{request,getHeaders:()=>({}),onResize:n=>resizes.push(n)})),payload);
 assert.deepEqual(resizes,[524288]);assert.deepEqual(ranges.slice(0,3),[[0,1048575],[0,524287],[524288,1048575]]);
});
test('wrong ranges, ignored ranges, truncated bodies and upstream errors are rejected',async()=>{
 for(const variant of ['wrong-start','wrong-total','ignored','short','long','error']){
  const request=async()=>({statusCode:variant==='ignored'?200:variant==='error'?503:206,headers:{'content-range':`bytes ${variant==='wrong-start'?1:0}-1048575/${variant==='wrong-total'?3000000:2000000}`},body:Readable.from([Buffer.alloc(variant==='long'?1048577:variant==='short'?12:1048576)])});
  await assert.rejects(collect(readRangeChunks(info(),2000000n,{request,getHeaders:()=>({})})),undefined,variant);
 }
});
test('403 retries are bounded, aborts stop immediately, and chunked responses need no content-length',async()=>{
 let calls=0;const request=async()=>{calls++;return {statusCode:403,headers:{},body:Readable.from([])};};
 await assert.rejects(collect(readRangeChunks(info(),2000000n,{request,getHeaders:()=>({})})));assert.equal(calls,5);
 const cancelled=info();cancelled.controller.abort();calls=0;await assert.rejects(collect(readRangeChunks(cancelled,100n,{request,getHeaders:()=>({})})));assert.equal(calls,0);
 const result=await collect(readRangeChunks(info(),3n,{request:async()=>({statusCode:206,headers:{'content-range':'bytes 0-2/3'},body:Readable.from([Buffer.from('abc')])}),getHeaders:()=>({})}));assert.equal(result.toString(),'abc');
});
