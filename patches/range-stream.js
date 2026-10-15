// Adapt to CDN range limits without skipping, duplicating or accepting error bodies.
export async function* readRangeChunks(info, size, {request, getHeaders, onResize=()=>{}}) {
    let chunkSize = info.service === 'youtube' ? 1048576n : 8000000n;
    const minimum = 65536n;
    let offset = 0n, chunksSinceRefresh = 0;
    while (offset < size) {
        let refreshed = false;
        for (;;) {
            info.controller.signal.throwIfAborted();
            const end = offset + chunkSize < size ? offset + chunkSize - 1n : size - 1n;
            const expected = end - offset + 1n;
            const response = await request(info.url, {
                headers: {...getHeaders(info.service), Range: `bytes=${offset}-${end}`},
                dispatcher: info.dispatcher, signal: info.controller.signal, maxRedirections: 4
            });
            // Undici emits an AbortError when an unread rejected body is destroyed.
            // The async iterator still propagates errors for accepted response bodies.
            response.body.on('error', () => {});
            try {
                if (response.statusCode === 403 && info.service === 'youtube' && chunkSize > minimum) {
                    chunkSize /= 2n;
                    onResize(Number(chunkSize));
                    continue;
                }
                if (response.statusCode === 403 && !refreshed && chunksSinceRefresh >= 3 && info.transplant) {
                    refreshed = true; chunksSinceRefresh = 0;
                    await info.transplant(info.dispatcher);
                    continue;
                }
                if (response.statusCode === 206) {
                    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(String(response.headers['content-range'] || ''));
                    if (!range || BigInt(range[1]) !== offset || BigInt(range[2]) !== end || BigInt(range[3]) !== size) throw Error('Invalid upstream content range');
                } else if (!(response.statusCode === 200 && offset === 0n && expected === size)) {
                    throw Error('Upstream range request failed');
                }
                const length = response.headers['content-length'];
                if (length !== undefined && (!/^\d+$/.test(String(length)) || BigInt(length) !== expected)) throw Error('Invalid upstream chunk length');
                let received = 0n;
                for await (const data of response.body) {
                    received += BigInt(data.length);
                    if (received > expected) throw Error('Upstream chunk exceeds requested range');
                    yield data;
                }
                if (received !== expected) throw Error('Incomplete upstream chunk');
                offset += received; chunksSinceRefresh++;
                break;
            } finally {
                response.body.destroy();
            }
        }
    }
}
