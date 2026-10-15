import {categoryOptions,categories} from './fixtures.mjs';
import {categoryLabel} from '../app/categories.mjs';
const menuLabels={...commonLabels,normal:categoryLabel(categories[0]),private:categoryLabel(categories[1])},mainKeyboard=makeKeyboard(categories),parseMessage=msg=>parseBase(msg,categoryOptions);
import test from 'node:test';import assert from 'node:assert/strict';
import {createUI,menuLabels as commonLabels,makeKeyboard,jobKeyboard,collapsedKeyboard} from '../app/telegram-ui.mjs';
import {parseMessage as parseBase} from '../app/telegram-core.mjs';
function fixture(){const state={owner:{userId:'123',chatId:'123'},quality:'1080',watches:{}};const sent=[],calls=[],requests=[];let time=1000;let list=[];
 const ui=createUI({...categoryOptions,state,save(){},now:()=>time,send:async(text,extra)=>{sent.push({text,...extra});return {message_id:sent.length};},telegram:async(method,data)=>{calls.push({method,data});},queue:async(route,method,data)=>{requests.push({route,method,data});if(route==='jobs')return{jobs:list};return{job:{...list.find(j=>route.includes(j.id)),state:route.endsWith('/retry')?'queued':'cancelled'}};}});
 return{state,sent,calls,requests,ui,setTime:n=>time=n,setJobs:j=>list=j};}
const message=(text,reply)=>({text,reply_to_message:reply?{message_id:reply}:undefined});
const callback=data=>({id:'q1',data,from:{id:123},message:{chat:{id:123,type:'private'}}});
const job={id:'1234abcd-1234-1234-1234-123456789012',url:'https://example.com/video',category:'normal',state:'downloading',bytes:1024};
test('menu prompts for link; private selection applies once, survives JSON restart',async()=>{const f=fixture();assert.equal(await f.ui.menuMessage(message(menuLabels.private)),true);assert.equal(f.sent[0].reply_markup.force_reply,true);const msg=message('https://example.com/video',1);assert.equal(await f.ui.resolveCategory(msg,parseMessage(msg)),'private');assert.equal(JSON.parse(JSON.stringify(f.state)).awaitingLink.category,'private');await f.ui.home();assert.equal(f.state.awaitingLink,null);const next=message('https://example.com/next');assert.equal(await f.ui.resolveCategory(next,parseMessage(next)),'normal');assert.deepEqual(f.sent.at(-1).reply_markup,collapsedKeyboard);});
test('expired private prompt and old replies refuse download instead of falling back to public',async()=>{const f=fixture();await f.ui.prompt('private');f.setTime(16*60000);let msg=message('https://example.com/a',1);assert.equal(await f.ui.resolveCategory(msg,parseMessage(msg)),null);await f.ui.prompt('normal');assert.equal(await f.ui.resolveCategory(msg,parseMessage(msg)),null);assert.equal(f.state.awaitingLink,null);});
test('callbacks verify actual owner and private chat before any action or acknowledgement',async()=>{const f=fixture();f.setJobs([job]);let q=callback('cancel:'+job.id);q.from.id=456;await f.ui.callback(q);assert.equal(f.requests.length,0);assert.equal(f.calls.length,0);q=callback('cancel:'+job.id);q.message.chat.type='group';await f.ui.callback(q);assert.equal(f.requests.length,0);});
test('quality, cancel, retry and stale buttons use current queue state',async()=>{const f=fixture();await f.ui.callback(callback('quality:720'));assert.equal(f.state.quality,'720');f.setJobs([job]);await f.ui.callback(callback('cancel:'+job.id));assert.ok(f.requests.some(r=>r.route.endsWith('/cancel')));f.setJobs([{...job,state:'failed'}]);await f.ui.callback(callback('retry:'+job.id));assert.equal(f.state.watches[job.id].lastState,'queued');const n=f.requests.filter(r=>r.method==='POST').length;f.setJobs([{...job,state:'completed'}]);await f.ui.callback(callback('retry:'+job.id));assert.equal(f.requests.filter(r=>r.method==='POST').length,n);});
test('task pagination and button data stay within Telegram limits',async()=>{const f=fixture();f.setJobs(Array.from({length:12},(_,i)=>({...job,id:`${String(i).padStart(8,'0')}-1234-1234-1234-123456789012`})));await f.ui.jobs();assert.equal(f.sent.length,6);assert.ok(f.sent.at(-1).reply_markup.inline_keyboard[0].some(b=>b.callback_data==='jobs:5'));for(const state of ['failed','downloading','completed'])for(const b of jobKeyboard({...job,state}).inline_keyboard.flat())assert.ok(Buffer.byteLength(b.callback_data)<=64);});

test('menu stays collapsed until clicked; selection collapses and keeps destination intent',async()=>{
 const f=fixture();await f.ui.home();assert.deepEqual(f.sent.at(-1).reply_markup,collapsedKeyboard);
 await f.ui.callback(callback('menu:open'));assert.deepEqual(f.calls.at(-1).data.reply_markup,mainKeyboard);
 await f.ui.callback(callback('menu:category:private'));assert.deepEqual(f.calls.at(-1).data.reply_markup,collapsedKeyboard);assert.equal(f.state.awaitingLink.category,'private');
 await f.ui.callback(callback('menu:close'));assert.equal(f.state.awaitingLink.category,'private');
 await f.ui.resetMenu();assert.equal(f.sent.at(-2).reply_markup.remove_keyboard,true);assert.deepEqual(f.sent.at(-1).reply_markup,collapsedKeyboard);assert.equal(f.state.awaitingLink.category,'private');
 await f.ui.home('提交完成');assert.deepEqual(f.sent.at(-1).reply_markup,collapsedKeyboard);
});
