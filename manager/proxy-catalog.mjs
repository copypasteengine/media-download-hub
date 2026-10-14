import crypto from 'node:crypto';
const idOf=config=>crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0,20);
export function describeNode(config,name='已保存的节点') {
 const out=config?.outbounds?.find(o=>!['freedom','blackhole','dns'].includes(o.protocol));
 if(!out)return null;const peer=out.settings?.vnext?.[0]||out.settings?.servers?.[0];
 return {id:idOf(config),name,protocol:out.protocol,server:peer?.address||'',port:peer?.port,config,sourceId:'local'};
}
export function ensureCatalog(proxy) {
 const p=structuredClone(proxy);p.selection=p.selection||'manual';
 if(!p.catalog){p.catalog={nodes:[],sources:[]};const sub=p.subscription;if(sub?.nodes?.length){const sourceId=sub.url?'s_'+crypto.createHash('sha256').update(sub.url).digest('hex').slice(0,16):'local';if(sub.url)p.catalog.sources.push({id:sourceId,name:'原有订阅',url:sub.url,updatedAt:sub.updatedAt,warnings:sub.warnings||[]});p.catalog.nodes=sub.nodes.map(n=>({...n,sourceId}));}delete p.subscription;}
 if(p.config){let current=p.catalog.nodes.find(n=>JSON.stringify(n.config)===JSON.stringify(p.config));if(!current){current=describeNode(p.config,p.selectedName||'原有节点');if(current)p.catalog.nodes.unshift(current);}if(current){p.selectedId=current.id;p.selectedName=current.name;}}
 return p;
}
export function publicProxy(proxy,operation={running:false}) {
 const p=ensureCatalog(proxy);return {mode:p.mode,selection:p.selection,selectedId:p.selectedId||null,selectedName:p.selectedName||null,autoStatus:p.autoStatus||null,operation,nodes:p.catalog.nodes.map(({config,...n})=>n),sources:p.catalog.sources.map(({url,...s})=>({...s,count:p.catalog.nodes.filter(n=>n.sourceId===s.id).length}))};
}
export function importCatalog(proxy,result,{url='',name='',sourceId}={}) {
 const p=ensureCatalog(proxy),id=sourceId||(url?'s_'+crypto.createHash('sha256').update(url).digest('hex').slice(0,16):'local');
 if(id!=='local'){
  const old=p.catalog.sources.find(s=>s.id===id);if(!url&&!old?.url)throw Error('订阅地址缺失');
  const source={id,name:String(name||old?.name||'订阅 '+(p.catalog.sources.length+1)).slice(0,80),url:url||old.url,updatedAt:new Date().toISOString(),warnings:result.warnings||[]};p.catalog.sources=p.catalog.sources.filter(s=>s.id!==id).concat(source);
  // Keep an in-use node as a local item if the provider removes it.
  p.catalog.nodes=p.catalog.nodes.filter(n=>n.sourceId!==id||n.id===p.selectedId).map(n=>n.sourceId===id?{...n,sourceId:'local'}:n);
 }
 for(const n of result.nodes){const index=p.catalog.nodes.findIndex(old=>old.id===n.id);const added={...n,sourceId:id,...(id==='local'&&name&&result.nodes.length===1?{name:name.slice(0,80)}:{})};if(index<0)p.catalog.nodes.push(added);else if(id==='local'||p.catalog.nodes[index].sourceId===id)p.catalog.nodes[index]={...added,check:p.catalog.nodes[index].check};}
 if(p.catalog.nodes.length>1000)throw Error('节点总数超过 1000，请删除不用的订阅');
 return p;
}
export function selectNode(proxy,id,selection='manual') {
 const p=ensureCatalog(proxy),n=p.catalog.nodes.find(n=>n.id===id);if(!n)throw Error('节点已不存在');
 return {...p,mode:'xray',selection,config:n.config,selectedId:n.id,selectedName:n.name,source:'catalog',autoPendingId:null};
}
export function fastestNode(nodes,now=Date.now()) {
 return nodes.filter(n=>n.check?.status==='ok'&&now-Date.parse(n.check.checkedAt)<15*60*1000).sort((a,b)=>a.check.latencyMs-b.check.latencyMs)[0]||null;
}
