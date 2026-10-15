import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough, Writable} from 'node:stream';
import {pipeMuxOutput} from '../patches/mux-output.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const child=new EventEmitter(),output=new PassThrough();child.stdio=[null,null,null,output];
 const chunks=[];const response=new Writable({write(data,_encoding,done){chunks.push(data);done();}});
 let cleanups=0;pipeMuxOutput(child,response,()=>cleanups++);
 return {child,output,response,chunks,cleanups:()=>cleanups};
}
test('mux waits for successful process exit before completing HTTP output',async()=>{
 const f=fixture();f.output.end('complete media');await tick();assert.equal(f.response.writableEnded,false);
 f.child.emit('close',0);await tick();assert.equal(f.response.writableFinished,true);assert.equal(Buffer.concat(f.chunks).toString(),'complete media');assert.equal(f.cleanups(),1);
});
test('mux rejects partial output on process failure even after stdout EOF',async()=>{
 const f=fixture();f.output.end('truncated media');await tick();f.child.emit('close',1);await tick();
 assert.equal(f.response.destroyed,true);assert.equal(f.response.writableFinished,false);assert.equal(f.cleanups(),1);
});
test('mux spawn errors and client disconnects clean up exactly once',async()=>{
 for(const kind of ['spawn','disconnect']){
  const f=fixture();if(kind==='spawn')f.child.emit('error',Error('spawn failed'));else f.response.destroy();await tick();
  f.child.emit('close',null);await tick();assert.equal(f.cleanups(),1);assert.equal(f.response.writableFinished,false);
 }
});
