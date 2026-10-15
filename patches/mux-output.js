// Do not finish the HTTP body until FFmpeg confirms that all inputs completed.
export function pipeMuxOutput(child, response, cleanup) {
    const output = child.stdio[3];
    let settled = false, ended = false, exited = false;
    const settle = success => {
        if (settled) return;
        settled = true;
        if (success) response.end();
        else response.destroy();
        cleanup();
    };
    const complete = () => { if (ended && exited) settle(true); };
    output.on('error', () => settle(false));
    output.on('end', () => { ended = true; complete(); });
    child.on('error', () => settle(false));
    child.on('close', code => {
        if (code !== 0) return settle(false);
        exited = true; complete();
    });
    response.on('error', () => settle(false));
    response.on('close', () => { if (!response.writableFinished) settle(false); });
    // Even a failure before the first media byte must carry the verified-mux
    // header, so clients can distinguish it from a failed connection to the API.
    response.flushHeaders?.();
    output.pipe(response, {end: false});
}
