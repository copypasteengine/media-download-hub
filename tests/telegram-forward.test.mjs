import test from 'node:test';
import assert from 'node:assert/strict';
import {createForwardFlow} from '../app/telegram-forward.mjs';
const categories=[{id:'movies',name:'电影',enabled:true},{id:'private',name:'私密',enabled:true,private:true}];
const msg={chat:{id:7,type:'private'},from:{id:7},message_id:10};
const source={type:'telegram',fileId:'source_123',uniqueId:'unique_123',filename:'video.mp4',size:1024};
function harness(customCategories=categories){let state={owner:{userId:'7',chatId:'7'},watches:{}},clock=1000;const messages=[],jobs=[];let fail=false;
 const make=()=>createForwardFlow({state,save(){},send:async(text,extra)=>{messages.push({text,...extra});return{message_id:messages.length};},telegram:async()=>{},categories:customCategories,now:()=>clock,queue:async(route,method,data)=>{if(fail){fail=false;throw Error('network');}let job=jobs.find(j=>j.requestId===data.requestId);if(!job){job={id:'job'+jobs.length,state:'queued',...data};jobs.push(job);}return{job};}});
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

test('typed automatic routes preserve explicit private intent and never change video confirmation',async()=>{
 const routes=[...categories,{id:'pictures',name:'图片',enabled:true,ready:true,attachmentTypes:['image'],autoSaveAttachments:true}];
 const h=harness(routes),image={...source,kind:'image',filename:'photo.jpg'};
 await h.flow.receive(msg,image,1);assert.equal(h.jobs[0].category,'pictures');
 h.state().awaitingLink={category:'private',expires:2000};await h.flow.receive(msg,image,2);assert.equal(h.jobs.length,1);const pending=Object.values(h.state().forwardRequests).find(p=>p.preferredCategory==='private');await h.flow.callback(h.q(pending.id,'private'));assert.equal(h.jobs[1].category,'private');
 h.state().awaitingLink={category:'private',expires:1};await h.flow.receive(msg,image,3);assert.equal(h.jobs.length,2);
 await h.flow.receive(msg,source,4);assert.equal(h.jobs.length,2);
 const waiting=harness(routes.map(c=>({...c,autoSaveAttachments:false})));await waiting.flow.receive(msg,image,1);assert.equal(waiting.jobs.length,0);assert.equal(waiting.messages[0].reply_markup.inline_keyboard[0][0].text,'推荐 · 图片');
 for(const route of [{...routes[2],enabled:false},{...routes[2],ready:false}]){const stopped=harness([...categories,route]);await stopped.flow.receive(msg,image,1);assert.equal(stopped.jobs.length,0);}
});
test('automatic albums separate attachment types, survive retries and deduplicate',async()=>{
 const routes=[...categories,{id:'pictures',name:'图片',ready:true,attachmentTypes:['image'],autoSaveAttachments:true},{id:'docs',name:'文档',ready:true,attachmentTypes:['document'],autoSaveAttachments:true}];
 const h=harness(routes),album={...msg,media_group_id:'mixed'};
 h.failNext();await assert.rejects(h.flow.receive(album,{...source,kind:'image'},1));h.restart();await h.flow.receive(album,{...source,kind:'image'},1);await h.flow.receive(album,{...source,kind:'image'},1);
 await h.flow.receive(album,{...source,kind:'document'},2);await h.flow.receive(album,source,3);
 assert.deepEqual(h.jobs.map(j=>j.category),['pictures','docs']);assert.equal(Object.keys(h.state().forwardRequests).length,3);
});
test('completed and cancelled selections do not exhaust the 50 pending-request slots',async()=>{
 const h=harness();
 for(let i=1;i<=55;i++){await h.flow.receive(msg,source,i);const id=Object.keys(h.state().forwardRequests).at(-1);await h.flow.callback(h.q(id,i%2?'movies':'_cancel'));}
 assert.equal(Object.keys(h.state().forwardRequests).length,55);
 await h.flow.receiveLinks(msg,['https://example.com/video'],56);assert.equal(Object.keys(h.state().forwardRequests).length,56);
 const busy=harness();for(let i=1;i<=51;i++)await busy.flow.receive(msg,source,i);
 assert.equal(Object.keys(busy.state().forwardRequests).length,50);assert.match(busy.messages.at(-1).text,/过多/);
});
