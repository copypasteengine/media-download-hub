import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Keep normalization and redirect resolution intact; replace external dependencies.
const fixture = `
const psl = {parse(hostname) {
    const parts = hostname.split('.');
    return {sld:parts.at(-2), tld:parts.at(-1), subdomain:parts.slice(0,-2).join('.') || null};
}};
const env = {enabledServices:new Set(['bilibili']), apiURL:'https://api.example/'};
const services = {bilibili:{subdomains:['m'], patterns:[{match(path) {
    const match = /^video\\/(BV[0-9A-Za-z]{10}|av[0-9]+)(?:\\?p=([0-9]+))?$/.exec(path);
    return match ? {comId:match[1], ...(match[2] ? {partId:match[2]} : {})} : null;
}}]}};
const getRedirectingURL = async () => globalThis.__bilibiliRedirect;
const friendlyServiceName = host => host;
`;
const source = fs.readFileSync(new URL('../patches/url.js', import.meta.url), 'utf8')
    .replace(/^import (?!.*node:assert).*;\n/gm, '');
const {normalizeURL, extract, resolveRedirectingURL} = await import(
    'data:text/javascript;base64,' + Buffer.from(fixture + source).toString('base64')
);
const id = 'BV1ab411c7XY';

test('Bilibili localized video pages preserve the selected part and remove tracking', () => {
    for (const host of ['www.bilibili.com', 'm.bilibili.com', 'bilibili.com']) {
        for (const locale of ['zh-Hans', 'zh-Hant', 'en']) {
            const url = normalizeURL(`https://${host}/${locale}/video/${id}/?share_source=COPY&p=3#reply`);
            assert.equal(url.pathname, `/video/${id}`);
            assert.equal(url.search, '?p=3');
            assert.equal(url.hash, '');
            assert.deepEqual(extract(url).patternMatch, {comId:id, partId:'3'});
        }
    }
    assert.equal(extract(normalizeURL('https://www.bilibili.com/zh-Hans/video/av123456')).patternMatch.comId, 'av123456');
});

test('Bilibili standard, international and unrelated service paths retain their meaning', () => {
    assert.equal(normalizeURL(`https://www.bilibili.com/video/${id}`).pathname, `/video/${id}`);
    assert.equal(normalizeURL('https://www.bilibili.tv/en/video/123456').pathname, '/_tv/en/video/123456');
    assert.equal(normalizeURL(`https://example.com/zh-Hans/video/${id}`).pathname, `/zh-Hans/video/${id}`);
    assert.equal(normalizeURL(`https://www.bilibili.com/space/zh-Hans/video/${id}`).pathname, `/space/zh-Hans/video/${id}`);
    assert.equal(extract(normalizeURL(`https://bilibili.com.evil.example/zh-Hans/video/${id}`)).error, 'link.invalid');
});

test('B23 redirects accept localized video pages and preserve part selection', async () => {
    try {
        globalThis.__bilibiliRedirect = `https://www.bilibili.com/zh-Hans/video/${id}?share_source=COPY&p=2`;
        assert.deepEqual(await resolveRedirectingURL('https://b23.tv/example'), {comId:id, partId:'2'});
        globalThis.__bilibiliRedirect = `https://example.com/zh-Hans/video/${id}`;
        assert.equal(await resolveRedirectingURL('https://b23.tv/example'), undefined);
    } finally {
        delete globalThis.__bilibiliRedirect;
    }
});
