import test from 'node:test';
import assert from 'node:assert/strict';
import {createForwardFlow} from '../app/telegram-forward.mjs';
import {createUI} from '../app/telegram-ui.mjs';
import {parseMessage} from '../app/telegram-core.mjs';
import {handleVideoLinks} from '../app/telegram-links.mjs';

const categories=[{id:'normal',name:'网络视频',enabled:true},{id:'anime',name:'动漫',enabled:true,aliases:['anime']},{id:'private',name:'私密',enabled:true,private:true}];
const base={chat:{id:7,type:'private'},from:{id:7},message_id:10};
function harness(){
 let state={owner:{userId:'7',chatId:'7'},quality:'1080',watches:{}},clock=1000,ui,forwards,fail=false;
 const messages=[],jobs=[];
 const options={categories,defaultCategory:'normal',save(){},now:()=>clock,send:async(text,extra)=>{messages.push({text,...extra});return{message_id:messages.length};},telegram:async()=>{},queue:async(route,method,data)=>{if(fail){fail=false;throw Error('network');}let job=jobs.find(j=>j.requestId===data.requestId);if(!job){job={id:'job'+jobs.length,state:'queued',...data};jobs.push(job);}return{job};}};
 function make(){ui=createUI({...options,state});forwards=createForwardFlow({...options,state,showJob:ui.showJob});}make();
 return {jobs,messages,state:()=>state,prompt:category=>ui.prompt(category),restart(){state=JSON.parse(JSON.stringify(state));make();},advance(){clock+=25*3600000;},failNext(){fail=true;},
  receive(text,extra={},updateId=1){const msg={...base,text,...extra};return handleVideoLinks({...options,ui,forwards,state,msg,parsed:parseMessage(msg,options),updateId});},
  choose(id,category,from=base.from){return forwards.callback({id:'callback',data:`forward:${id}:${category}`,message:base,from});},id(){return Object.keys(state.forwardRequests||{}).at(-1);}};
}
test('forwarded YouTube link never uses default or stale menu selection; only chosen category queues',async()=>{
 const h=harness();await h.prompt('private');
 await h.receive('https://youtu.be/abcdefghijk',{forward_origin:{type:'channel'}});
 assert.equal(h.jobs.length,0);assert.equal(h.state().awaitingLink,null);assert.match(h.messages.at(-1).text,/选择前不会开始下载/);
 const id=h.id();h.restart();await h.choose(id,'anime');assert.equal(h.jobs.length,1);assert.equal(h.jobs[0].category,'anime');assert.equal(h.jobs[0].quality,'1080');
 await h.choose(id,'anime');assert.equal(h.jobs.length,1);
 await h.receive('https://youtu.be/abcdefghijk',{forward_date:123},2);assert.equal(h.jobs.length,1);assert.notEqual(h.id(),id);
});
test('plain, hidden and /download links ask; explicit menu and category commands apply once',async()=>{
 for(const [text,extra] of [['https://youtu.be/abcdefghijk',{}],['点击视频',{entities:[{type:'text_link',url:'https://youtu.be/abcdefghijk'}]}],['/download https://youtu.be/abcdefghijk',{}]]){
  const h=harness();await h.receive(text,extra);assert.equal(h.jobs.length,0);assert.ok(h.id());
 }
 const h=harness();await h.prompt('anime');await h.receive('https://youtu.be/abcdefghijk');assert.equal(h.jobs[0].category,'anime');assert.equal(h.state().awaitingLink,null);
 await h.receive('https://youtu.be/abcdefghijk',{},2);assert.equal(h.jobs.length,1);assert.ok(h.id());
 const command=harness();await command.receive('/anime https://youtu.be/abcdefghijk');assert.equal(command.jobs[0].category,'anime');
});
test('link batches preserve quality, survive queue uncertainty and cannot be redirected by stale buttons',async()=>{
 const h=harness();await h.receive('https://youtu.be/abcdefghijk https://youtu.be/lmnopqrstuv');const id=h.id();h.state().quality='720';
 await h.choose(id,'private',{id:99});assert.equal(h.jobs.length,0);
 h.failNext();await assert.rejects(h.choose(id,'private'));h.restart();await h.choose(id,'private');
 assert.equal(h.jobs.length,2);assert.ok(h.jobs.every(j=>j.category==='private'&&j.quality==='1080'));assert.equal(new Set(h.jobs.map(j=>j.requestId)).size,2);
 await h.choose(id,'anime');assert.equal(h.jobs.length,2);
 for(const mode of ['cancel','expire','removed']){const f=harness();await f.receive('https://youtu.be/abcdefghijk');const key=f.id();if(mode==='cancel')await f.choose(key,'_cancel');if(mode==='expire')f.advance();await f.choose(key,mode==='removed'?'missing':'normal');assert.equal(f.jobs.length,0);}
});
test('expired selected prompts and Telegram message links never create downloads',async()=>{
 const h=harness();await h.prompt('private');h.advance();await h.receive('https://youtu.be/abcdefghijk');assert.equal(h.jobs.length,0);assert.equal(h.id(),undefined);
 const tg=harness();await tg.receive('https://t.me/channel/123');assert.equal(tg.jobs.length,0);assert.equal(tg.id(),undefined);assert.match(tg.messages.at(-1).text,/直接把附件转发/);
});
