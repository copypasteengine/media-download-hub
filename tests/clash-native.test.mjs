import test from 'node:test';import assert from 'node:assert/strict';
import {parseSubscription}from'../manager/proxy-import.mjs';
import {nativeClashConfig}from'../manager/clash-native.mjs';
import {xrayConfig}from'../manager/core.mjs';
import {ensureCatalog,publicProxy,selectNode,importCatalog}from'../manager/proxy-catalog.mjs';
const any={name:'AnyTLS example',type:'anytls',server:'edge.example.com',port:443,password:'test-secret',sni:'cdn.example.com','client-fingerprint':'chrome'};
const hy={name:'HY2 example',type:'hysteria2',server:'edge.example.com',ports:'12001-13000,14000',password:'test-secret','hop-interval':29,up:'30 Mbps',down:'300 Mbps','bbr-profile':'aggressive'};
const vless={name:'XHTTP example',type:'vless',server:'edge.example.com',port:443,uuid:'12345678-1234-1234-1234-123456789abc',encryption:'none',tls:true,network:'xhttp','xhttp-opts':{path:'/video',host:'cdn.example.com',mode:'stream-one'},'reality-opts':{'public-key':'test-key','short-id':'abcd'}};
test('Clash modern protocols retain authentication, hopping and XHTTP/ECH settings',()=>{
 const ech={...vless,name:'ECH example','ech-opts':{enable:true,'query-server-name':'dns.example.com'}};delete ech['reality-opts'];
 const r=parseSubscription(JSON.stringify({proxies:[any,hy,vless,ech]}));assert.equal(r.nodes.length,4);assert.deepEqual(r.warnings,[]);
 for(let i=0;i<4;i++)assert.deepEqual(r.nodes[i].config.node,{...[any,hy,vless,ech][i],name:'proxy'});
 assert.equal(r.nodes[1].port,12001);assert.equal(r.nodes[2].config.node['xhttp-opts'].mode,'stream-one');
});
test('Full subscription cannot activate its controller, listeners, TUN or routing policy',()=>{
 const r=parseSubscription(JSON.stringify({proxies:[any],tun:{enable:true},'external-controller':'0.0.0.0:9090','mixed-port':7890,rules:['MATCH,DIRECT'],'proxy-providers':{malicious:{path:'/config/settings.json'}}}));
 const c=xrayConfig({proxy:{mode:'xray',config:r.nodes[0].config}});c.inbounds[0]={listen:'127.0.0.1',port:12345,protocol:'http'};
 const native=nativeClashConfig(c);assert.equal(native.port,12345);assert.equal(native['allow-lan'],false);assert.equal(native['external-controller'],'');assert.equal(native.tun.enable,false);assert.deepEqual(native.rules,['MATCH,proxy']);assert.equal(native['proxy-providers'],undefined);
 assert.throws(()=>nativeClashConfig({...c,inbounds:[{protocol:'http',listen:'8.8.8.8',port:12345}]}));
});
test('Native nodes survive selection, migration and public serialization without exposing secrets',()=>{
 const r=parseSubscription(JSON.stringify({proxies:[any]}));const p=selectNode(importCatalog({mode:'direct'},r),r.nodes[0].id);const migrated=ensureCatalog({mode:'xray',config:p.config});assert.equal(migrated.selectedId,p.selectedId);
 const visible=JSON.stringify(publicProxy(p));assert(!visible.includes('test-secret'));assert(!visible.includes('config'));assert.equal(JSON.parse(visible).nodes[0].protocol,'anytls');
});
test('Invalid hopping ranges and unsupported node capabilities fail explicitly',()=>{
 for(const ports of ['0-100','300-200','65536','1:2','1-65536',''])assert.throws(()=>parseSubscription(JSON.stringify({proxies:[{...hy,ports}]})));
 for(const extra of [{'dialer-proxy':'other'},{certificate:'/config/settings.json'},{'interface-name':'eth0'}])assert.throws(()=>parseSubscription(JSON.stringify({proxies:[{...any,...extra}]})));
});
