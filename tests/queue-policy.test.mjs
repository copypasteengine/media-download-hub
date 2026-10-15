import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ensureQueueCapacity,completedFileExists,canAccessJob} from '../app/queue-policy.mjs';
import {volumeIdentity,stagingDirectory} from '../app/storage-guard.mjs';
import {validateStorageSeparation,storageRoots} from '../app/storage.mjs';

test('queue capacity counts all active states but not completed or failed history',()=>{
 assert.doesNotThrow(()=>ensureQueueCapacity([...Array(49).fill({state:'queued'}),...Array(100).fill({state:'failed'})]));
 assert.throws(()=>ensureQueueCapacity([...Array(49).fill({state:'downloading'}),{state:'checking'}]),e=>e.status===429);
});
test('changed privacy applies to existing jobs and completed dedup requires the actual destination file',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mdh-policy-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const job={owner:'owner',category:'videos',private:false,state:'completed',target:path.join(root,'video.mp4'),bytes:3};
 assert.equal(canAccessJob(job,{username:'owner',private:false},[{id:'videos',private:true}]),false);
 assert.equal(canAccessJob(job,{username:'other',private:true},[]),false);
 assert.equal(canAccessJob({...job,private:true},{username:'owner',private:false},[]),false);
 fs.writeFileSync(job.target,'abc');assert.equal(completedFileExists(job,root),true);
 assert.equal(completedFileExists(job,path.join(root,'moved')),false);
 fs.unlinkSync(job.target);assert.equal(completedFileExists(job,root),false);
 fs.writeFileSync(path.join(root,'other'),'abc');fs.symlinkSync(path.join(root,'other'),job.target);assert.equal(completedFileExists(job,root),false);
});
test('volume markers, category roots and staging directories cannot redirect writes through symlinks',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mdh-storage-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'media'),outside=path.join(root,'outside');fs.mkdirSync(dir);fs.mkdirSync(outside);fs.writeFileSync(path.join(dir,'.cobalt-volume'),'volume');
 assert.equal(volumeIdentity(dir),'volume');assert.equal(stagingDirectory(dir),path.join(dir,'.cobalt-partials'));
 fs.rmdirSync(path.join(dir,'.cobalt-partials'));fs.symlinkSync(outside,path.join(dir,'.cobalt-partials'));assert.throws(()=>stagingDirectory(dir));assert.deepEqual(fs.readdirSync(outside),[]);
 fs.unlinkSync(path.join(dir,'.cobalt-volume'));fs.writeFileSync(path.join(root,'marker'),'volume');fs.symlinkSync(path.join(root,'marker'),path.join(dir,'.cobalt-volume'));assert.throws(()=>volumeIdentity(dir));
 fs.symlinkSync(dir,path.join(root,'alias'));assert.throws(()=>volumeIdentity(path.join(root,'alias')));
});
test('categories across overlapping storage roots cannot share or nest physical directories',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mdh-roots-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'nested'));
 const roots=storageRoots({STORAGE_ROOTS:JSON.stringify([{id:'main',name:'Main',path:root},{id:'nested',name:'Nested',path:path.join(root,'nested')}])});
 assert.throws(()=>validateStorageSeparation([{storageId:'main',path:'nested'},{storageId:'nested',path:'private'}],roots));
 assert.throws(()=>validateStorageSeparation([{storageId:'main',path:'nested/video'},{storageId:'nested',path:'video'}],roots));
 assert.doesNotThrow(()=>validateStorageSeparation([{storageId:'main',path:'normal'},{storageId:'nested',path:'private'}],roots));
});
