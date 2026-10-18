// SIP002 plugin options use backslash escaping, independently of URL encoding.
export function parsePluginOptions(value) {
 const parts=[];let key='',val='',equals=false,escaped=false;
 const push=()=>{parts.push([key,equals?val:true]);key='';val='';equals=false;};
 for(const ch of value){
  if(escaped){if(equals)val+=ch;else key+=ch;escaped=false;}
  else if(ch==='\\')escaped=true;
  else if(ch===';')push();
  else if(ch==='='&&!equals)equals=true;
  else if(equals)val+=ch;else key+=ch;
 }
 if(escaped)throw Error('SS 插件参数转义不完整');push();
 const [name]=parts.shift();const options=Object.create(null);
 for(const [k,v]of parts){if(!k&&v===true)continue;if(!k||Object.hasOwn(options,k))throw Error('SS 插件参数重复或无效');options[k]=v;}
 return {name,options};
}
export function simpleObfs(name,options={}) {
 if(!name)return null;
 if(!['obfs-local','simple-obfs','obfs'].includes(name))throw Error('不支持此 SS 插件；目前支持 obfs-local / simple-obfs 的 HTTP、TLS 混淆');
 for(const key of Object.keys(options))if(!['obfs','obfs-host','obfs-uri','mode','host','uri','fast-open'].includes(key))throw Error('SS 混淆包含不支持的参数');
 if(options.obfs&&options.mode||options['obfs-host']&&options.host||options['obfs-uri']&&options.uri)throw Error('SS 混淆参数冲突');
 const mode=options.obfs||options.mode;
 if(!['http','tls'].includes(mode))throw Error('SS 混淆方式必须为 http 或 tls');
 const host=options['obfs-host']??options.host??'';
 const uri=options['obfs-uri']??options.uri??'';
 if(typeof host!=='string'||host.length>255||/[\s\x00-\x1f\x7f]/.test(host))throw Error('SS 混淆主机名无效');
 if(typeof uri!=='string'||uri.length>2048||/[\x00-\x1f\x7f]/.test(uri)||uri&&!uri.startsWith('/'))throw Error('SS 混淆路径无效');
 if(Object.hasOwn(options,'fast-open')&&![true,false,'true','false','1','0'].includes(options['fast-open']))throw Error('SS fast-open 参数无效');
 return {name:'obfs-local',mode,host,uri,fastOpen:[true,'true','1'].includes(options['fast-open'])};
}
