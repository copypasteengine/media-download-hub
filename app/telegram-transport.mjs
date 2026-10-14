// Recreate a failed proxy connection pool; never replay sendMessage here.
// The caller owns retry/offset handling so an uncertain delivery isn't retried twice.
export function createTelegramTransport({token,makeProxy,fetchImpl=fetch,signal,onFailure=()=>{}}){
 let proxy=makeProxy();
 async function request(method,data={},timeout=30000){
  const used=proxy;
  let d,r;
  try{
   r=await fetchImpl(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),dispatcher:used,signal:AbortSignal.any([signal,AbortSignal.timeout(timeout)])});
   d=await r.json();
  }catch(e){
   if(!signal.aborted){
    if(proxy===used){proxy=makeProxy();Promise.resolve(used.destroy()).catch(()=>{});}
    onFailure({method,error:e.name||'Error',cause:e.cause?.code||e.code||'unknown'});
   }
   throw e;
  }
  if(!r.ok||!d.ok){const e=new Error('Telegram API '+(d.error_code||r.status));e.retryAfter=d.parameters?.retry_after;throw e;}
  return d.result;
 }
 return {request,close:()=>proxy.destroy()};
}
