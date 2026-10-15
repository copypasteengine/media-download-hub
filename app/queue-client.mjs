export function createQueueClient(cfg,fetchImpl=fetch){
 let session=null,loggingIn=null;
 async function login(){
  if(session)return session;
  if(loggingIn)return loggingIn;
  loggingIn=(async()=>{
   const r=await fetchImpl(cfg.queueUrl+'/nas/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:cfg.queueUsername,password:cfg.queuePassword}),signal:AbortSignal.timeout(10000)});
   if(!r.ok)throw Error('下载队列登录失败');
   const cookie=r.headers.get('set-cookie')?.split(';')[0];
   if(!cookie)throw Error('下载队列未返回登录凭据');
   const me=await fetchImpl(cfg.queueUrl+'/nas/api/me',{headers:{Cookie:cookie},signal:AbortSignal.timeout(10000)});
   if(!me.ok)throw Error('下载队列会话初始化失败');
   const data=await me.json();if(!data.csrf)throw Error('下载队列会话初始化失败');session={cookie,csrf:data.csrf};return session;
  })();try{return await loggingIn;}finally{loggingIn=null;}
 }
 return async function queue(route,method='GET',data,retried=false){
  const used=await login();
  const r=await fetchImpl(cfg.queueUrl+'/nas/api/'+route,{method,headers:{Cookie:used.cookie,'X-CSRF-Token':used.csrf,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(15000)});
  if(r.status===401&&!retried){if(session===used)session=null;return queue(route,method,data,true);}
  const result=await r.json();if(!r.ok)throw Object.assign(new Error(result.error||'队列请求失败'),{permanent:r.status>=400&&r.status<500&&r.status!==429});
  return result;
 };
}
