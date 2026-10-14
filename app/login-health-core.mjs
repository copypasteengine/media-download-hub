const names={bilibili:'B站',youtube:'YouTube'};
export const SIX_HOURS=6*60*60*1000,RETRY=15*60*1000,DAY=24*60*60*1000;
export function applyProbe(previous={},result,now=Date.now()) {
 const status=result.status==='unconfigured'&&previous.everConfigured?'invalid':result.status;
 const state={...previous,status,checkedAt:new Date(now).toISOString(),
  everConfigured:previous.everConfigured||result.status!=='unconfigured',
  invalidCount:status==='invalid'?(previous.invalidCount||0)+1:0,
  unknownCount:status==='unknown'?(previous.unknownCount||0)+1:0,
  nextCheckAt:now+(['invalid','unknown'].includes(status)?RETRY:SIX_HOURS)};
 let event=null;
 if(status==='valid') {
  state.lastValidAt=state.checkedAt;
  if(previous.issue)event={kind:'recovered'};
  state.issue=null;
 } else {
  const issue=state.invalidCount>=2?'expired':state.unknownCount>=3?'unreachable':null;
  if(issue&&(previous.issue!==issue||now-(previous.lastAlertAt||0)>=DAY)) {
   event={kind:issue};state.issue=issue;state.lastAlertAt=now;
  }
 }
 return {state,event};
}
export function alertText(platform,kind) {
 const name=names[platform];
 if(kind==='expired')return `${name} 登录态连续两次检查未通过，需要重新登录更新。${platform==='bilibili'?'下载可能退回匿名低画质。':'公开视频仍可匿名下载；需账号权限的视频可能失败。'}\n请在官方网页登录后更新服务器保存的登录态，不要把密码或 Cookie 发到聊天里。`;
 if(kind==='unreachable')return `${name} 登录检查连续三次未能完成，暂时无法判断登录态是否有效。请检查服务器网络${platform==='youtube'?'及下载服务专用代理':''}，暂不需要重新登录。`;
 return `${name} 登录检查已恢复正常。`;
}
export function statusText(snapshot) {
 const labels={valid:'登录有效',invalid:'登录验证未通过',unknown:'暂时无法验证（网络或接口异常）',unconfigured:'尚未配置登录',pending:'等待检查'};
 return ['平台登录状态',...Object.entries(names).map(([p,name])=>{
  const s=snapshot.platforms?.[p]||{};
  const checked=s.checkedAt?new Date(s.checkedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚未检查';
  return `${name}：${labels[s.status]||labels.pending}\n上次检查：${checked}`;
 }),'正常时每 6 小时检查；异常后每 15 分钟复核。登录失效连续确认两次后提醒，持续网络异常三次后单独提醒；同类提醒最多每天一次。'].join('\n\n');
}
export async function deliverLoginAlerts({snapshot,state,save,send}) {
 if(!state.owner)return;
 state.loginAlertsSeen??=[];
 for(const alert of snapshot.alerts||[]) {
  if(state.loginAlertsSeen.includes(alert.id))continue;
  await send(alert.message,{},'platform-login:'+alert.id);
  state.loginAlertsSeen=[...state.loginAlertsSeen,alert.id].slice(-100);save();
 }
}
