import test from 'node:test';
import assert from 'node:assert/strict';
import {applyProbe,alertText,statusText,deliverLoginAlerts,DAY,RETRY,SIX_HOURS} from '../app/login-health-core.mjs';
import {checkBilibili,checkYouTube} from '../app/login-probes.mjs';
test('expiry requires two consecutive negative checks and reminders survive restarts',()=>{
 let s=applyProbe({}, {status:'valid'},1000).state;
 let r=applyProbe(s,{status:'invalid'},2000);assert.equal(r.event,null);assert.equal(r.state.nextCheckAt,2000+RETRY);
 r=applyProbe(r.state,{status:'invalid'},2000+RETRY);assert.equal(r.event.kind,'expired');
 s=JSON.parse(JSON.stringify(r.state));
 r=applyProbe(s,{status:'invalid'},2000+2*RETRY);assert.equal(r.event,null);
 r=applyProbe(r.state,{status:'invalid'},s.lastAlertAt+DAY);assert.equal(r.event.kind,'expired');
 r=applyProbe(r.state,{status:'valid'},s.lastAlertAt+DAY+1000);assert.equal(r.event.kind,'recovered');
 assert.equal(r.state.nextCheckAt,s.lastAlertAt+DAY+1000+SIX_HOURS);
 assert.equal(applyProbe(r.state,{status:'valid'},s.lastAlertAt+DAY+2000).event,null);
});
test('network errors never count as expired cookies and get distinct alerts',()=>{
 let r=applyProbe({}, {status:'invalid'},1);
 r=applyProbe(r.state,{status:'unknown'},2);assert.equal(r.state.invalidCount,0);assert.equal(r.event,null);
 r=applyProbe(r.state,{status:'unknown'},3);assert.equal(r.event,null);
 r=applyProbe(r.state,{status:'unknown'},4);assert.equal(r.event.kind,'unreachable');
 assert.match(alertText('youtube',r.event.kind),/暂不需要重新登录/);
 assert.equal(applyProbe({}, {status:'unconfigured'},1).event,null);
});
test('Bilibili uses explicit server auth status and treats rate limits as unknown',async()=>{
 for(const [body,status] of [[{code:0,data:{isLogin:true}},'valid'],[{code:-101},'invalid'],[{code:0,data:{isLogin:false}},'invalid'],[{code:-412},'unknown']]){
  const r=await checkBilibili('test-cookie',async(url,options)=>{assert.equal(new URL(url).hostname,'api.bilibili.com');assert.equal(options.redirect,'error');return {ok:true,json:async()=>body}});
  assert.equal(r.status,status);
 }
 assert.equal((await checkBilibili('test-cookie',async()=>{throw Error('timeout')})).status,'unknown');
});
test('YouTube requires authenticated account API response, not a local logged_in flag',async()=>{
 const check=async(getInfo)=>checkYouTube('test-cookie',{Innertube:{create:async()=>({session:{logged_in:true},account:{getInfo}})}});
 assert.equal((await check(async()=>[{}])).status,'valid');
 assert.equal((await check(async()=>[])).status,'invalid');
 assert.equal((await check(async()=>{throw Error('network')})).status,'unknown');
 assert.equal((await check(async()=>{throw {info:{error:{status:'UNAUTHENTICATED'}}}})).status,'invalid');
});
test('only bound owner is notified; confirmed delivery deduplicates, failed sends retry',async()=>{
 const snapshot={alerts:[{id:'one',message:'test'}]},state={owner:{chatId:'owner'}},sent=[];
 const args={snapshot,state,save(){},send:async(...v)=>sent.push(v)};
 await deliverLoginAlerts(args);await deliverLoginAlerts({...args,state:JSON.parse(JSON.stringify(state))});assert.equal(sent.length,1);
 await deliverLoginAlerts({...args,state:{}});assert.equal(sent.length,1);
 const failed={owner:{chatId:'owner'}};
 await assert.rejects(()=>deliverLoginAlerts({...args,state:failed,send:async()=>{throw Error('offline')}}));
 assert.deepEqual(failed.loginAlertsSeen,[]);
 await deliverLoginAlerts({...args,state:failed});assert.equal(sent.length,2);
 assert.match(statusText({platforms:{bilibili:{status:'unknown'}}}),/网络或接口异常/);
});
