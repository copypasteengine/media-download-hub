import {ensureCatalog,selectNode,fastestNode}from'./proxy-catalog.mjs';
export function createProxyController({read,save,probe,validate,isDownloading,isPaused,now=()=>Date.now()}) {
 let operation={running:false},abort=null,nextAuto=now()+60000;
 function update(fn){const s=read();s.proxy=fn(ensureCatalog(s.proxy));save(s);}
 const state=()=>({...operation});
 async function run(ids,automatic=false,checkCurrentFirst=false){
  if(operation.running)throw Error('正在检测节点，请等待或取消');
  const p=ensureCatalog(read().proxy),nodes=ids.map(id=>p.catalog.nodes.find(n=>n.id===id)).filter(Boolean).slice(0,30);
  if(!nodes.length)throw Error('请先导入节点');
  abort=new AbortController();const controller=abort;operation={running:true,total:nodes.length,completed:0,automatic,label:'准备检测',startedAt:new Date().toISOString()};
  const background=(async()=>{
   try{
    for(const n of nodes){if(controller.signal.aborted||isPaused())break;operation.currentId=n.id;operation.label='检测 '+n.name;const check=await probe(n,controller.signal);if(check.status==='cancelled')break;
     update(p=>{const node=p.catalog.nodes.find(v=>v.id===n.id);if(node)node.check=check;return p;});operation.completed++;
     if(checkCurrentFirst&&n.id===p.selectedId&&check.status==='ok'){operation.label='当前节点可用，保持连接';update(p=>({...p,autoStatus:'当前节点可用，保持连接'}));return;}
    }
    if(automatic&&!controller.signal.aborted&&!isPaused()){
     const current=ensureCatalog(read().proxy);if(current.selection!=='auto')return;const best=fastestNode(current.catalog.nodes,now());
     if(!best){update(p=>({...p,autoPendingId:null,autoStatus:'本轮没有可用节点，保留原连接设置'}));return;}
     if(best.id===current.selectedId&&current.mode==='xray'){update(p=>({...p,autoStatus:'当前节点可用'}));return;}
     if(isDownloading()){update(p=>({...p,autoPendingId:best.id,autoStatus:'已找到可用节点，等待下载空闲后切换'}));nextAuto=now()+30000;return;}
     const proposed=selectNode(current,best.id,'auto');await validate(proposed);if(controller.signal.aborted||isPaused())return;update(p=>({...selectNode(p,best.id,'auto'),autoStatus:'已自动选择可用节点'}));
    }
   }catch{operation.error='节点检测未完成，请重试';}
   finally{operation.running=false;operation.currentId=null;operation.finishedAt=new Date().toISOString();if(abort===controller)abort=null;}
  })();return {started:true,done:background};
 }
 async function start({ids,automatic=false,checkCurrentFirst=false}={}){const p=ensureCatalog(read().proxy);if(automatic)nextAuto=now()+10*60*1000;const list=ids||[p.selectedId,...p.catalog.nodes.map(n=>n.id)].filter((id,i,a)=>id&&a.indexOf(id)===i);return run(list,automatic,checkCurrentFirst);}
 async function tick(){if(operation.running||isPaused()||now()<nextAuto)return;const p=ensureCatalog(read().proxy);if(p.selection!=='auto'||!p.catalog.nodes.length)return;if(p.autoPendingId&&isDownloading()){nextAuto=now()+30000;return;}nextAuto=now()+10*60*1000;await start({automatic:true,checkCurrentFirst:!p.autoPendingId}).catch(()=>{});}
 function cancel(){abort?.abort();operation.label='正在停止检测';}
 return {state,start,tick,cancel};
}
