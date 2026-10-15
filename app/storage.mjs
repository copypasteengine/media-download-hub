import fs from 'node:fs';
import path from 'node:path';

export function storageRoots(env=process.env) {
  const roots=env.STORAGE_ROOTS?JSON.parse(env.STORAGE_ROOTS):[{id:'main',name:env.STORAGE_NAME||'下载存储',path:env.MEDIA_ROOT||'/downloads'}];
  if(!Array.isArray(roots)||!roots.length||roots.length>20)throw Error('需要配置 1–20 个存储位置');
  const ids=new Set();
  return roots.map(r=>{
    if(!/^[a-z][a-z0-9_-]{0,31}$/.test(r.id||'')||ids.has(r.id)||!path.isAbsolute(r.path||'')||r.path==='/'||!r.name)throw Error('存储位置配置无效');
    ids.add(r.id);return {id:r.id,name:String(r.name).slice(0,60),path:path.resolve(r.path)};
  });
}
export function relativePath(value) {
  if(value==='.')return value;
  if(typeof value!=='string'||!value||value.length>500||path.posix.isAbsolute(value)||value.split('/').some(p=>!p||p==='.'||p==='..')||/[\\\x00-\x1f]/.test(value))throw Error('目录路径无效');
  return value;
}
export function safeDirectory(root,relative='.') {
  relativePath(relative);
  if(!fs.existsSync(root)||!fs.lstatSync(root).isDirectory())throw Error('存储位置当前不可用，或使用了符号链接，请检查磁盘挂载');
  let target=root;
  for(const part of relative==='.'?[]:relative.split('/')) {
    target=path.join(target,part);
    if(fs.existsSync(target)||(()=>{try{fs.lstatSync(target);return true;}catch{return false;}})()) {
      const stat=fs.lstatSync(target);
      if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('不能选择符号链接或非目录路径');
    }
  }
  return target;
}
export function categoryPath(category,roots=storageRoots()) {
  const root=roots.find(r=>r.id===(category.storageId||'main'));
  if(!root)throw Error('原存储位置未挂载，请重新选择目录');
  return safeDirectory(root.path,category.path);
}
export function validateStorageSeparation(categories,roots=storageRoots()) {
  const paths=categories.map(c=>{
    categoryPath(c,roots);
    const root=roots.find(r=>r.id===(c.storageId||'main'));
    return path.resolve(fs.realpathSync(root.path),c.path);
  });
  for(let i=0;i<paths.length;i++)for(let j=i+1;j<paths.length;j++){
    if(paths[i]===paths[j]||paths[i].startsWith(paths[j]+'/')||paths[j].startsWith(paths[i]+'/'))throw Error('不同存储位置中的分类目录不能重叠或互相嵌套');
    if(fs.existsSync(paths[i])&&fs.existsSync(paths[j])){const a=fs.statSync(paths[i]),b=fs.statSync(paths[j]);if(a.dev===b.dev&&a.ino===b.ino)throw Error('两个分类指向同一个实际目录');}
  }
}
export function browseDirectory(roots,id,relative='.') {
  const root=roots.find(r=>r.id===id);if(!root)throw Error('存储位置不存在');
  const target=safeDirectory(root.path,relative);
  const directories=fs.readdirSync(target,{withFileTypes:true}).filter(d=>d.isDirectory()&&!d.isSymbolicLink()&&!d.name.startsWith('.')).map(d=>({name:d.name,path:relative==='.'?d.name:relative+'/'+d.name})).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
  if(directories.length>2000)throw Error('此目录子目录过多，请使用更具体的存储根目录');
  return {storageId:id,name:root.name,path:relative,parent:relative==='.'?null:(path.posix.dirname(relative)||'.'),directories};
}
export function createDirectory(roots,id,parent,name) {
  if(typeof name!=='string'||!name.trim()||name!==name.trim()||name.startsWith('.')||name.length>128||/[\/\\\x00-\x1f]/.test(name))throw Error('请输入有效文件夹名称');
  const root=roots.find(r=>r.id===id);if(!root)throw Error('存储位置不存在');
  const p=safeDirectory(root.path,parent),relative=parent==='.'?name:parent+'/'+name;
  if(fs.existsSync(path.join(p,name)))throw Error('同名目录或文件已存在');
  fs.mkdirSync(path.join(p,name),{mode:0o755});return {storageId:id,path:relative};
}
