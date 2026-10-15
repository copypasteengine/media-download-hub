import {categories} from './fixtures.mjs';
import {categoryLabel} from '../app/categories.mjs';
const menuLabels={...commonLabels,normal:categoryLabel(categories[0]),private:categoryLabel(categories[1])},normalizedAction=data=>actionBase(data,{categories});
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizedMessage,normalizedAction as actionBase,acceptIncoming,messageCard,menuLabels as commonLabels,isOwner} from '../app/feishu-core.mjs';
import {createUI} from '../app/telegram-ui.mjs';
import {parseMessage} from '../app/telegram-core.mjs';
const message=(overrides={})=>({sender:{sender_type:'user',sender_id:{open_id:'ou_owner'}},message:{chat_type:'p2p',chat_id:'oc_private',message_id:'om_1',message_type:'text',content:JSON.stringify({text:'/start secret'})},...overrides});
test('only human private chats normalize; rich text extracts links',()=>{
 assert.equal(normalizedMessage(message()).text,'/start secret');
 const group=message();group.message.chat_type='group';assert.equal(normalizedMessage(group),null);
 const bot=message();bot.sender.sender_type='app';assert.equal(normalizedMessage(bot),null);
 const post=message();post.message.message_type='post';post.message.content=JSON.stringify({zh_cn:{title:'视频',content:[[{tag:'a',href:'https://example.com/watch',text:'观看'}]]}});
 assert.match(normalizedMessage(post).text,/https:\/\/example.com\/watch/);
});
test('first binding requires secret, then both owner and chat are checked',()=>{
 const state={owner:null,inbox:[],seen:[]},item=normalizedMessage(message());
 assert.equal(acceptIncoming(state,{...item,text:'/start wrong'},'secret'),false);
 assert.equal(acceptIncoming(state,item,'secret'),true);
 state.owner={userId:item.userId,chatId:item.chatId};
 assert.equal(acceptIncoming(state,{...item,id:'2',userId:'ou_other'},'secret'),false);
 assert.equal(acceptIncoming(state,{...item,id:'3',chatId:'oc_group'},'secret'),false);
 assert.equal(isOwner(state.owner,{...item,userId:'other'}),false);
});
test('durable inbox deduplicates redelivery before and after restart',()=>{
 const item=normalizedMessage(message()),state={owner:null,inbox:[],seen:[]};
 acceptIncoming(state,item,'secret');const restored=JSON.parse(JSON.stringify(state));
 acceptIncoming(restored,item,'secret');assert.equal(restored.inbox.length,1);
 restored.inbox=[];restored.seen=[item.id];acceptIncoming(restored,item,'secret');assert.equal(restored.inbox.length,0);
});
test('card events require valid identity and known operation; separate clicks stay distinct',()=>{
 const raw={event_id:'click1',operator:{open_id:'ou_owner'},context:{open_chat_id:'oc_private',open_message_id:'om_card'},action:{value:{kind:'menu',label:menuLabels.normal}}};
 assert.equal(normalizedAction(raw).value.label,menuLabels.normal);
 assert.notEqual(normalizedAction(raw).id,normalizedAction({...raw,event_id:'click2'}).id);
 assert.equal(normalizedAction({...raw,action:{value:{kind:'callback',data:'arbitrary-delete'}}}),null);
 assert.equal(normalizedAction({...raw,event_id:null}),null);
});
test('cards render collected titles as plain text and disable forwarding',()=>{
 const card=messageCard('[secret](https://evil.example) <at id=all>');
 assert.equal(card.config.enable_forward,false);assert.equal(card.elements[0].text.tag,'plain_text');
 const menu=messageCard('选择',{reply_markup:{keyboard:[[menuLabels.normal,menuLabels.private]]}});
 assert.equal(menu.elements[1].actions[1].value.label,menuLabels.private);
});
test('every Feishu home-card button is accepted and category click reaches the link prompt',async()=>{
 const state={owner:{userId:'ou_owner',chatId:'oc_private'},watches:{}},sent=[];
 const ui=createUI({state,categories,defaultCategory:'normal',allowDefaultCategory:true,compactMenu:false,save(){},send:async(text,extra)=>{sent.push({text,...extra});return {message_id:'om_'+sent.length};},telegram:async()=>{},queue:async()=>({jobs:[]})});
 await ui.home();const card=messageCard(sent[0].text,sent[0]);
 for(const button of card.elements.slice(1).flatMap(row=>row.actions)){
  const action=normalizedAction({event_id:'click-'+button.value.data,operator:{open_id:'ou_owner'},context:{open_chat_id:'oc_private',open_message_id:'om_card'},action:{value:button.value}});
  assert.ok(action,'button accepted: '+button.value.data);
 }
 await ui.callback({id:'click',data:'menu:category:private',from:{id:'ou_owner'},message:{chat:{id:'oc_private',type:'private'}}});
 assert.equal(state.awaitingLink.category,'private');assert.match(sent.at(-1).text,/隐藏收藏/);
 const msg={text:'https://example.com/video'};assert.equal(await ui.resolveCategory(msg,parseMessage(msg,{categories,defaultCategory:'normal'})),'private');
 await ui.home();assert.equal(await ui.resolveCategory(msg,parseMessage(msg,{categories,defaultCategory:'normal'})),'normal');
 await ui.callback({id:'click2',data:'menu:open',from:{id:'ou_owner'},message:{chat:{id:'oc_private',type:'private'}}});assert.ok(sent.at(-1).reply_markup.inline_keyboard.flat().some(b=>b.callback_data==='menu:category:normal'));
});
