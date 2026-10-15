import test from 'node:test';
import assert from 'node:assert/strict';
import {visionOSPlayerRequest} from '../patches/youtube-client.js';
test('VisionOS player adaptation preserves video request, locale and existing authentication',()=>{
 const original={method:'POST',headers:{Cookie:'test-session','X-Youtube-Client-Name':'5'},body:JSON.stringify({videoId:'sample',context:{client:{hl:'zh-CN',gl:'US',visitorData:'test-visitor',clientName:'IOS',androidSdkVersion:30},user:{lockedSafetyMode:false}},playbackContext:{test:true}})};
 const result=visionOSPlayerRequest(new URL('https://www.youtube.com/youtubei/v1/player?prettyPrint=false'),original),body=JSON.parse(result.body);
 assert.equal(body.videoId,'sample');assert.equal(body.context.client.clientName,'VISIONOS');assert.equal(body.context.client.clientVersion,'1.02');assert.equal(body.context.client.hl,'zh-CN');assert.equal(body.context.client.visitorData,'test-visitor');assert.equal(body.context.client.androidSdkVersion,undefined);assert.deepEqual(body.playbackContext,{test:true});
 assert.equal(result.headers.get('X-Youtube-Client-Name'),'101');assert.equal(result.headers.get('Cookie'),'test-session');assert.equal(JSON.parse(original.body).context.client.clientName,'IOS');
});
test('VisionOS adaptation leaves media URLs, unrelated endpoints and origins untouched',()=>{
 const init={method:'GET'};
 for(const url of ['https://www.youtube.com/youtubei/v1/browse','https://www.youtube.com/watch?v=sample','https://cdn.example/youtubei/v1/player','https://www.youtube.com.evil.example/youtubei/v1/player'])assert.equal(visionOSPlayerRequest(new URL(url),init),init);
});
