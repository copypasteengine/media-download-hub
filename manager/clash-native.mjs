// Only a single outbound is imported. Subscription listeners, DNS, rules,
// providers, scripts and external controllers never become runtime settings.
const common=['name','type','server','port','udp','sni','servername','alpn','client-fingerprint','skip-cert-verify','fingerprint'];
const fields={
 anytls:['password','idle-session-check-interval','idle-session-timeout','min-idle-session'],
 hysteria2:['password','ports','hop-interval','bbr-profile','up','down','obfs','obfs-password','cwnd'],
 vless:['uuid','encryption','tls','network','flow','packet-encoding','xhttp-opts','reality-opts','ech-opts'],
};
export function nativeClashNode(input){
 if(!input||!fields[input.type])throw Error('不支持的 Clash 节点协议');
 if(input['dialer-proxy'])throw Error('暂不支持链式代理');
 for(const key of Object.keys(input))if(![...common,...fields[input.type]].includes(key))throw Error('该 Clash 节点含暂不支持的参数');
 if(typeof input.server!=='string'||!input.server||input.server.length>253||/[\s/\x00-\x1f\x7f]/.test(input.server))throw Error('节点地址无效');
 let port=Number(input.port);
 if(input.type==='hysteria2'&&input.ports!==undefined){
  const ranges=String(input.ports).split(',');
  if(!ranges.length||ranges.length>64)throw Error('Hysteria2 跳跃端口无效');
  for(const range of ranges){if(!/^\d+(?:-\d+)?$/.test(range))throw Error('Hysteria2 跳跃端口无效');const [a,b=a]=range.split('-').map(Number);if(a<1||b>65535||a>b)throw Error('Hysteria2 跳跃端口无效');}
  if(input.port===undefined)port=Number(ranges[0].split('-')[0]);
 }
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('节点端口无效');
 const credential=input.type==='vless'?'uuid':'password';if(typeof input[credential]!=='string'||!input[credential])throw Error('节点缺少认证信息');
 if(input.type==='vless'&&input.network!=='xhttp'&&!input['ech-opts']&&(!input.encryption||input.encryption==='none'))throw Error('该节点无需 Clash 原生内核');
 if(input.network&&!['xhttp','tcp','ws','grpc','h2','http','httpupgrade'].includes(input.network))throw Error('不支持的传输方式');
 if(input['xhttp-opts']?.mode&&!['auto','stream-one','stream-up','packet-up'].includes(input['xhttp-opts'].mode))throw Error('XHTTP 模式无效');
 const node=structuredClone(input);node.name='proxy';if(input.port!==undefined)node.port=port;
 return {node,port};
}
export function nativeClashConfig(input){
 const {node}=nativeClashNode(input.node),inbound=input.inbounds?.[0];
 if(!inbound||inbound.protocol!=='http'||!['127.0.0.1','0.0.0.0'].includes(inbound.listen)||!Number.isInteger(inbound.port)||inbound.port<1||inbound.port>65535)throw Error('代理监听设置无效');
 return {
  port:inbound.port,'bind-address':inbound.listen,'allow-lan':inbound.listen!=='127.0.0.1',
  mode:'rule','log-level':'silent',ipv6:false,'find-process-mode':'off',
  'external-controller':'','geo-auto-update':false,'geodata-mode':false,
  profile:{'store-selected':false,'store-fake-ip':false},
  dns:{enable:false},tun:{enable:false},proxies:[node],'proxy-groups':[],rules:['MATCH,proxy'],
 };
}
