import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../patches/youtube.js',import.meta.url),'utf8');
const wrapper=source.slice(source.indexOf('export default async function(o)'))
 .replace('export default async function(o)','return async function(o)')
 .replace('(await import("./youtube-account.js")).default','accountDownload');
test('public media stays anonymous; only account-required failures use stored account',async()=>{
 const calls=[];let result={filename:'public.mp4'},cookie='session';
 const run=new Function('download','accountCookie','accountDownload',wrapper)(async()=>result,()=>cookie,async o=>{calls.push(o);return {filename:'authenticated.mkv'}});
 assert.equal((await run({id:'sample'})).filename,'public.mp4');assert.equal(calls.length,0);
 result={error:'content.video.private'};
 assert.equal((await run({id:'sample'})).filename,'authenticated.mkv');assert.equal(calls[0].useAccount,true);
 cookie='';assert.deepEqual(await run({id:'sample'}),result);assert.equal(calls.length,1);
 cookie='session';result={error:'fetch.rate'};assert.deepEqual(await run({id:'sample'}),result);assert.equal(calls.length,1);
});
test('stream refresh preserves the account route without retrying anonymous access',async()=>{
 const run=new Function('download','accountCookie','accountDownload',wrapper)(async()=>{throw Error('anonymous should not run')},()=>'',async o=>({itag:o.itag,account:o.useAccount}));
 assert.deepEqual(await run({useAccount:true,itag:{video:313}}),{itag:{video:313},account:true});
});
