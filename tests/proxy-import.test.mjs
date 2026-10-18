import test from 'node:test';import assert from 'node:assert/strict';
import {parseSubscription,publicAddress,fetchSubscription}from'../manager/proxy-import.mjs';
import {parsePluginOptions}from'../manager/ss-plugin.mjs';
const vless='vless://12345678-1234-1234-1234-123456789abc@edge.example.com:443?security=reality&type=tcp&sni=www.example.com&pbk=public-test-key&sid=ab&flow=xtls-rprx-vision#My%20node';
test('Imports links and Base64 subscriptions, preserves REALITY and skips unsupported protocols',()=>{const text=vless+'\n'+'hysteria2://unsupported@example.com:443';for(const input of [text,Buffer.from(text).toString('base64')]){const r=parseSubscription(input);assert.equal(r.nodes.length,1);assert.equal(r.nodes[0].name,'My node');assert.equal(r.nodes[0].config.outbounds[0].streamSettings.realitySettings.publicKey,'public-test-key');assert.equal(r.warnings.length,1);}assert.equal(parseSubscription(vless+'\n'+vless).nodes.length,1);});
test('Imports Clash YAML, VMess and Shadowsocks with encoded passwords',()=>{const yaml=`mixed-port: 7890\nproxies:\n  - name: websocket\n    type: vless\n    server: edge.example.com\n    port: 443\n    uuid: example-id\n    tls: true\n    network: ws\n    ws-opts:\n      path: /video\n      headers:\n        Host: video.example.com\n`;const o=parseSubscription(yaml).nodes[0].config.outbounds[0];assert.equal(o.streamSettings.wsSettings.headers.Host,'video.example.com');assert.equal(o.streamSettings.security,'tls');const vmess='vmess://'+Buffer.from(JSON.stringify({v:'2',ps:'vm',add:'edge.example.com',port:443,id:'test-id',net:'grpc',path:'svc',tls:'tls'})).toString('base64');assert.equal(parseSubscription(vmess).nodes[0].config.outbounds[0].streamSettings.grpcSettings.serviceName,'svc');const ss='ss://'+Buffer.from('aes-256-gcm:a:b').toString('base64url')+'@edge.example.com:8388#ss';assert.equal(parseSubscription(ss).nodes[0].config.outbounds[0].settings.servers[0].password,'a:b');assert.throws(()=>parseSubscription('proxies: [{name: h, type: hysteria2}]'));});
test('Subscription fetch rejects private networks and parsing has input bounds',async()=>{for(const ip of ['127.0.0.1','192.168.1.1','169.254.169.254','::1','::ffff:127.0.0.1','fe80::1','100.100.100.200'])assert.equal(publicAddress(ip),false);assert(publicAddress('1.1.1.1'));await assert.rejects(()=>fetchSubscription('http://127.0.0.1/secret'));await assert.rejects(()=>fetchSubscription('file:///etc/passwd'));assert.throws(()=>parseSubscription('a'.repeat(2*1024*1024+1)));assert.throws(()=>parseSubscription('{bad json'));});
test('SS plugins preserve obfs TLS host suffixes, plain and base64 credentials',()=>{
 const plugin=encodeURIComponent('obfs-local;obfs=tls;obfs-host=cdn.example.com:95556');
 for(const auth of ['chacha20-ietf-poly1305:example',Buffer.from('chacha20-ietf-poly1305:example').toString('base64url')]){
  const o=parseSubscription('SG-X5-2: ss://'+auth+'@edge.example.com:2377?plugin='+plugin+'#SG-X5-2').nodes[0].config.outbounds[0];
  assert.equal(o._mdhObfs.mode,'tls');assert.equal(o._mdhObfs.host,'cdn.example.com:95556');assert.equal(o.settings.servers[0].address,'edge.example.com');assert.equal(o.streamSettings.security,'none');
 }
 const empty=parseSubscription('ss://aes-256-gcm:plugin=literal@edge.example.com:8388?plugin=').nodes[0].config.outbounds[0];assert.equal(empty.settings.servers[0].password,'plugin=literal');assert.equal(empty._mdhObfs,undefined);
 const old='ss://'+Buffer.from('aes-256-gcm:example@edge.example.com:8388').toString('base64');assert.equal(parseSubscription(old).nodes[0].port,8388);
});
test('Clash obfs and SIP002 HTTP plugin options agree',()=>{
 const uri='ss://aes-256-gcm:example@edge.example.com:8388?plugin='+encodeURIComponent('simple-obfs;obfs=http;obfs-host=cdn.example.com;obfs-uri=/media');
 const yaml='proxies: [{type: ss, server: edge.example.com, port: 8388, cipher: aes-256-gcm, password: example, plugin: obfs, plugin-opts: {mode: http, host: cdn.example.com, uri: /media}}]';
 assert.deepEqual(parseSubscription(uri).nodes[0].config,parseSubscription(yaml).nodes[0].config);
 const escaped=parsePluginOptions(String.raw`obfs-local;obfs=http;obfs-uri=/a\;b\=c\\d`);assert.equal(escaped.options['obfs-uri'],'/a;b=c\\d');
});
test('Plugin failures stay explicit and do not fall back to a broken plain SS connection',()=>{
 const base='ss://aes-256-gcm:example@edge.example.com:8388?plugin=';
 for(const value of ['v2ray-plugin;mode=quic','obfs-local;obfs=udp','obfs-local;obfs=tls;obfs=tls','obfs-local;obfs=http;obfs-host=bad\r\nhost','obfs-local;obfs=tls;executable=/tmp/script'])assert.throws(()=>parseSubscription(base+encodeURIComponent(value)));
 assert.throws(()=>parseSubscription(base+'&plugin='),/重复/);
 assert.throws(()=>parsePluginOptions('obfs-local;obfs=tls\\'),/转义/);
});
