// VisionOS player context used by yt-dlp 2026.08.19. The pinned youtubei.js
// parser understands its response but does not yet expose this client name.
const client = Object.freeze({
    clientName: 'VISIONOS', clientVersion: '1.02', deviceMake: 'Apple',
    deviceModel: 'RealityDevice17,1', osName: 'visionOS', osVersion: '26.5.23O471',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
});
export function visionOSPlayerRequest(url, init) {
    if (url.origin !== 'https://www.youtube.com' || url.pathname !== '/youtubei/v1/player') return init;
    const body = JSON.parse(init.body);
    body.context = {...body.context, client: {...body.context?.client, ...client}};
    delete body.context.client.androidSdkVersion;
    const headers = new Headers(init.headers);
    headers.set('X-Youtube-Client-Name', '101');
    headers.set('X-Youtube-Client-Version', client.clientVersion);
    headers.set('User-Agent', client.userAgent);
    return {...init, headers, body: JSON.stringify(body)};
}
