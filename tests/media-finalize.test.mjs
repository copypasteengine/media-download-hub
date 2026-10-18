import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {finalizeMedia} from '../app/media-finalize.mjs';

const ffmpeg=process.env.FFMPEG_PATH||'ffmpeg';
const available=spawnSync(ffmpeg,['-version']).status===0;
function temporary(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'mdh-finalize-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return path.join(root,'download.part');}
function run(args){const r=spawnSync(ffmpeg,['-nostdin','-v','error',...args],{maxBuffer:8*1024**2});assert.equal(r.status,0,r.stderr?.toString());return r.stdout;}
test('streaming MKV is finalized with duration while preserving every audio/video packet',{skip:!available},async t=>{
 const file=temporary(t);
 const original=run(['-f','lavfi','-i','testsrc2=size=128x96:rate=10:duration=1','-f','lavfi','-i','sine=duration=1','-c:v','libvpx-vp9','-threads','1','-c:a','libopus','-f','matroska','pipe:1']);
 fs.writeFileSync(file,original);
 const inspect=()=>spawnSync(ffmpeg,['-hide_banner','-i',file],{encoding:'utf8'}).stderr;
 assert.match(inspect(),/Duration: N\/A/);
 const hash=()=>run(['-i',file,'-map','0','-c','copy','-f','streamhash','-hash','sha256','-']).toString();
 const before=hash();
 const size=await finalizeMedia({file,extension:'.mkv',ffmpeg});
 assert.match(inspect(),/Duration: 00:00:01/);assert.equal(hash(),before);
 assert.equal(size,fs.statSync(file).size);assert.equal(fs.existsSync(file+'.indexing'),false);
});
test('failed finalization retains input and removes temporary output',{skip:!available},async t=>{
 const file=temporary(t);fs.writeFileSync(file,'not a video');
 await assert.rejects(finalizeMedia({file,extension:'.mkv',ffmpeg}),/封装检查失败/);
 assert.equal(fs.readFileSync(file,'utf8'),'not a video');assert.equal(fs.existsSync(file+'.indexing'),false);
});
test('storage failures and cancellation never publish a changed file',async t=>{
 const file=temporary(t);fs.writeFileSync(file,'original');
 await assert.rejects(finalizeMedia({file,extension:'.mkv',ffmpeg,checkStorage:()=>{throw new Error('disk missing');}}),/disk missing/);
 await assert.rejects(finalizeMedia({file,extension:'.mkv',ffmpeg,reserveBytes:Number.MAX_SAFE_INTEGER}),/空间不足/);
 await assert.rejects(finalizeMedia({file,extension:'.mkv',ffmpeg,signal:AbortSignal.abort()}));
 assert.equal(fs.readFileSync(file,'utf8'),'original');assert.equal(fs.existsSync(file+'.indexing'),false);
});
test('other media and attachment formats are left byte-for-byte intact',async t=>{
 const file=temporary(t);fs.writeFileSync(file,'original');
 assert.equal(await finalizeMedia({file,extension:'.mp4'}),8);
 assert.equal(fs.readFileSync(file,'utf8'),'original');
});
