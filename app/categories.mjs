export const DEFAULT_CATEGORIES=[{id:'videos',storageId:'main',name:'视频',path:'Videos',private:false,enabled:true,ready:false,aliases:[]}];
export const activeCategories=categories=>categories.filter(c=>c.enabled!==false);
export const categoryLabel=c=>(c.private?'🔒':'📥')+' 下载到'+c.name;
export function botCategories(categories){return categories.map(({id,name,private:privacy,enabled,aliases})=>({id,name,private:!!privacy,enabled:enabled!==false,aliases:aliases||[]}));}
export function validateCategories(categories,defaultCategory,relativeDirectory){
 if(!Array.isArray(categories)||!categories.length||categories.length>20)throw Error('请设置 1–20 个下载分类');
 const ids=new Set(),names=new Set(),aliases=new Set();
 const out=categories.map(c=>{
  if(!/^[a-z][a-z0-9_-]{0,31}$/.test(c.id||''))throw Error('分类 ID 无效');
  if(ids.has(c.id))throw Error('分类 ID 重复');ids.add(c.id);
  const name=String(c.name||'').trim();if(!name||name.length>30||/[\x00-\x1f]/.test(name)||names.has(name))throw Error('分类名称需为 1–30 个字符且不能重复');names.add(name);
  const a=c.aliases||[];if(!Array.isArray(a)||a.length>4)throw Error('每个分类最多 4 个命令别名');for(const alias of a){if(!/^[a-z][a-z0-9_]{0,31}$/.test(alias)||['start','menu','help','download','status','cancel','retry','quality','settings'].includes(alias)||aliases.has(alias))throw Error('命令别名不合法或重复');aliases.add(alias);}
  if(c.storageId&&!/^[a-z][a-z0-9_-]{0,31}$/.test(c.storageId))throw Error('存储位置 ID 无效');
  return {...c,storageId:c.storageId||'main',name,path:relativeDirectory(c.path),enabled:c.enabled!==false,private:!!c.private,aliases:a};
 });
 for(let i=0;i<out.length;i++)for(let j=i+1;j<out.length;j++)if(out[i].storageId===out[j].storageId&&(out[i].path==='.'||out[j].path==='.'||out[i].path===out[j].path||out[i].path.startsWith(out[j].path+'/')||out[j].path.startsWith(out[i].path+'/')))throw Error('分类路径不能相同或互相嵌套');
 if(!out.some(c=>c.id===defaultCategory&&c.enabled))throw Error('默认分类必须存在并启用');return out;
}
