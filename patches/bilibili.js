import { env } from "../../config.js";
import { resolveRedirectingURL } from "../url.js";

import { readFileSync } from "node:fs";

export function selectVideo(content, quality = "1080") {
    const videos = (content || []).filter(v => v.baseUrl || v.base_url || v.url)
        .map(v => ({...v, baseUrl: v.baseUrl || v.base_url || v.url,
                    size: Math.min(Number(v.width) || 0, Number(v.height) || 0)}));
    const ceiling = quality === "max" ? Infinity : Number(quality) || 1080;
    const eligible = videos.filter(v => v.size <= ceiling);
    // Prefer resolution before bandwidth: a high-bitrate 480p stream is not 1080p.
    const pool = eligible.length ? eligible : videos.filter(v => v.size === Math.min(...videos.map(v => v.size)));
    return pool.sort((a,b) => b.size-a.size || Number(b.bandwidth||0)-Number(a.bandwidth||0))[0];
}
function getBest(content) {
    return (content || []).filter(v => v.baseUrl || v.base_url || v.url)
        .map(v => ({...v, baseUrl:v.baseUrl || v.base_url || v.url}))
        .sort((a,b) => Number(b.bandwidth||0)-Number(a.bandwidth||0))[0];
}
function extractBestQuality(dashData, quality) {
    return [selectVideo(dashData?.video, quality), getBest(dashData?.audio)];
}
function accountCookie() {
    try {
        const value = JSON.parse(readFileSync(process.env.BILIBILI_COOKIE_PATH || "/config/platform-auth/bilibili.json", "utf8")).cookie;
        if (typeof value === "string" && !/[\r\n]/.test(value)) return value;
    } catch (e) {
        if (e.code !== "ENOENT") throw Error("Invalid Bilibili login configuration");
    }
    return "";
}
async function com_download(id, partId, quality) {
    const headers = { "user-agent": "Mozilla/5.0", referer: "https://www.bilibili.com/" };
    const cookie = accountCookie();
    if (cookie) headers.cookie = cookie;
    const get = url => fetch(url, {headers, redirect:"error", signal:AbortSignal.timeout(20000)}).then(r => r.json());
    const key = id.startsWith("BV") ? `bvid=${encodeURIComponent(id)}` : `aid=${encodeURIComponent(id.replace(/^av/, ""))}`;
    const info = await get(`https://api.bilibili.com/x/web-interface/view?${key}`);
    const details = info?.code === 0 ? info.data : null;
    if (!details) return {error:"fetch.empty"};
    const page = details.pages?.find(p => p.page === Number(partId || 1));
    const cid = page?.cid ?? (!partId ? details.cid : null);
    if (!cid) return {error:"fetch.empty"};
    // Request all account-permitted DASH formats, then honor the user's resolution.
    const streamData = await get(`https://api.bilibili.com/x/player/playurl?${key}&cid=${cid}&qn=127&fnval=4048&fourk=1`);
    if (streamData.code !== 0 || !streamData.data?.dash) return {error:"fetch.empty"};
    if (streamData.data.timelength > env.durationLimit * 1000) return {error:"content.too_long"};
    const [video, audio] = extractBestQuality(streamData.data.dash, quality);
    if (!video || !audio) return {error:"fetch.empty"};

    let filenameBase = `bilibili_${id}`;
    if (partId) {
        filenameBase += `_${partId}`;
    }

    const title = details?.title && (details.pages?.length > 1 && page
        ? `${details.title} - P${page.page}${page.part && page.part !== details.title ? ` ${page.part}` : ""}`
        : details.title);
    const author = details?.owner?.name;
    return {
        filenameAttributes: title ? {
            service: "bilibili", id: details.bvid || id, title, author,
            resolution: `${video.width}x${video.height}`, qualityLabel: `${video.size}p`, extension: "mp4"
        } : undefined,
        fileMetadata: title ? {
            title, artist: author,
            date: details.pubdate ? new Date(details.pubdate * 1000).toISOString().slice(0, 10) : undefined
        } : undefined,
        urls: [video.baseUrl, audio.baseUrl],
        audioFilename: `${filenameBase}_audio`,
        filename: `${filenameBase}_${video.width}x${video.height}.mp4`,
    };
}

async function tv_download(id, quality) {
    const url = new URL(
        'https://api.bilibili.tv/intl/gateway/web/playurl'
        + '?s_locale=en_US&platform=web&qn=64&type=0&device=wap'
        + '&tf=0&spm_id=bstar-web.ugc-video-detail.0.0&from_spm_id='
    );

    url.searchParams.set('aid', id);

    const { data } = await fetch(url).then(a => a.json());
    if (!data?.playurl?.video) {
        return { error: "fetch.empty" };
    }

    const [ video, audio ] = extractBestQuality({
        video: data.playurl.video.map(s => s.video_resource)
                                 .filter(s => s.codecs.includes('avc1')),
        audio: data.playurl.audio_resource
    }, quality);

    if (!video || !audio) {
        return { error: "fetch.empty" };
    }

    if (video.duration > env.durationLimit * 1000) {
        return { error: "content.too_long" };
    }

    return {
        urls: [video.url, audio.url],
        audioFilename: `bilibili_tv_${id}_audio`,
        filename: `bilibili_tv_${id}.mp4`
    };
}

export default async function({ comId, tvId, comShortLink, partId, quality = "1080" }) {
    if (comShortLink) {
        const patternMatch = await resolveRedirectingURL(`https://b23.tv/${comShortLink}`);
        comId = patternMatch?.comId;
        partId = patternMatch?.partId ?? partId;
    }

    if (comId) {
        return com_download(comId, partId, quality);
    } else if (tvId) {
        return tv_download(tvId, quality);
    }

    return { error: "fetch.fail" };
}
