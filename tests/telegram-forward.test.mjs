import test from 'node:test';
import assert from 'node:assert/strict';
import {createForwardFlow} from '../app/telegram-forward.mjs';
const categories=[{id:'movies',name:'电影',enabled:true},{id:'private',name:'私密',enabled:true,private:true}];
const msg={chat:{id:7,type:'private'},from:{id:7},message_id:10};
const source={type:'telegram',fileId:'source_123',uniqueId:'unique_123',filename:'video.mp4',size:1024};
function harness(){let state={owner:{userId:'7',chatId:'7'},watches:{}},clock=1000;const messages=[],jobs=[];let fail=false;
 const make=()=>createForwardFlow({state,save(){},send:async(text,extra)=>{messages.push({text,...extra});return{message_id:messages.length};},telegram:async()=>{},categories,now:()=>clock,queue:async(route,method,data)=>{if(fail){fail=false;throw Error('network');}let job=jobs.find(j=>j.requestId===data.requestId);if(!job){job={id:'job'+jobs.length,state:'queued',...data};jobs.push(job);}return{job};}});
 return {flow:make(),state:()=>state,messages,jobs,restart(){state=JSON.parse(JSON.stringify(state));this.flow=make();},failNext(){fail=true;},advance(){clock+=25*3600000;},q(id,category,from=msg.from){return{id:'callback',data:`forward:${id}:${category}`,message:msg,from};}};
}
test('every independent forward waits for a destination, including after a prior menu selection',async()=>{
 const h=harness();h.state().awaitingLink={category:'movies'};
 await h.flow.receive(msg,source,1);assert.equal(h.jobs.length,0);assert.equal(h.state().awaitingLink,null);
 let id=Object.keys(h.state().forwardRequests)[0];assert(h.messages[0].reply_markup.inline_keyboard.flat().every(b=>b.callback_data.length<=64));
 await h.flow.callback(h.q(id,'private'));assert.equal(h.jobs[0].category,'private');
 await h.flow.receive(msg,source,2);assert.equal(h.jobs.length,1);assert.equal(Object.keys(h.state().forwardRequests).length,2);
});
test('albums ask once and retain choice across restart without duplicating submitted files',async()=>{
 const h=harness(),album={...msg,media_group_id:'album-123'};
 await h.flow.receive(album,source,1);await h.flow.receive(album,source,2);assert.equal(h.messages.length,1);assert.equal(h.jobs.length,0);
 const id=Object.keys(h.state().forwardRequests)[0];h.restart();await h.flow.callback(h.q(id,'movies'));assert.equal(h.jobs.length,2);
 await h.flow.receive(album,source,3);assert.equal(h.jobs.length,3);assert(h.jobs.every(j=>j.category==='movies'));
 await h.flow.callback(h.q(id,'movies'));await h.flow.receive(album,source,3);assert.equal(h.jobs.length,3);
 await h.flow.callback(h.q(id,'private'));assert.equal(h.jobs.length,3);
});
test('unauthorized, cancelled, expired and removed destination choices never default to another library',async()=>{
 const h=harness();await h.flow.receive(msg,source,1);const id=Object.keys(h.state().forwardRequests)[0];
 await h.flow.callback(h.q(id,'private',{id:99}));await h.flow.callback(h.q(id,'removed'));assert.equal(h.jobs.length,0);
 await h.flow.callback(h.q(id,'_cancel'));await h.flow.callback(h.q(id,'movies'));assert.equal(h.jobs.length,0);
 await h.flow.receive(msg,source,2);const second=Object.keys(h.state().forwardRequests).at(-1);h.advance();await h.flow.callback(h.q(second,'movies'));assert.equal(h.jobs.length,0);
});
test('queue failure preserves choice and can resume after restart',async()=>{
 const h=harness();await h.flow.receive(msg,source,1);const id=Object.keys(h.state().forwardRequests)[0];h.failNext();
 await assert.rejects(h.flow.callback(h.q(id,'private')));h.restart();await h.flow.callback(h.q(id,'private'));assert.equal(h.jobs.length,1);assert.equal(h.jobs[0].category,'private');
});
