export async function checkBilibili(cookie,fetchImpl=fetch) {
 if(!cookie)return {status:'unconfigured'};
 try {
  const r=await fetchImpl('https://api.bilibili.com/x/web-interface/nav',{
   headers:{cookie,'user-agent':'Mozilla/5.0',referer:'https://www.bilibili.com/'},redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!r.ok)return {status:'unknown'};
  const d=await r.json();
  if(d.code===0&&d.data?.isLogin===true)return {status:'valid'};
  if(d.code===-101||(d.code===0&&d.data?.isLogin===false))return {status:'invalid'};
 }catch{}
 return {status:'unknown'};
}
export async function checkYouTube(cookie,{Innertube,fetchImpl}) {
 if(!cookie)return {status:'unconfigured'};
 try {
  const yt=await Innertube.create({cookie,retrieve_player:false,fetch:fetchImpl});
  // The session.logged_in flag alone only proves a cookie was supplied.
  // Validate with an authenticated server request instead.
  const accounts=await yt.account.getInfo(true);
  if(Array.isArray(accounts)&&accounts.length)return {status:'valid'};
  if(Array.isArray(accounts))return {status:'invalid'};
 }catch(e) {
  const status=e?.response?.status||e?.status||e?.info?.status_code;
  if(status===401||e?.info?.error?.status==='UNAUTHENTICATED')return {status:'invalid'};
 }
 return {status:'unknown'};
}
