export function downloadOptions(job) {
  const high = job.quality === 'max' || Number(job.quality) > 1080;
  return {
    url: job.url, videoQuality: job.quality, downloadMode: 'auto',
    filenameStyle: 'pretty', localProcessing: 'disabled', alwaysProxy: true,
    // YouTube's high-resolution formats commonly use VP9/AV1, not H.264.
    youtubeVideoCodec: high ? 'vp9' : 'h264',
    youtubeVideoContainer: high ? 'mkv' : 'auto',
  };
}
export function downloadError(code) {
  const details = {
    'error.api.youtube.login': 'YouTube 要求登录验证；请检查平台登录态或服务专用代理出口',
    'error.api.youtube.token_expired': 'YouTube 登录态已失效，需要重新登录更新',
    'error.api.youtube.no_session_tokens': 'YouTube 会话令牌尚未就绪',
    'error.api.youtube.decipher': 'YouTube 播放签名解析失败，需要更新解析器',
    'error.api.content.video.age': '视频需要年龄验证，请使用已满足条件的平台账号',
    'error.api.content.video.private': '视频非公开，当前平台账号无权访问',
    'error.api.fetch.rate': '平台请求频率受限，请稍后重试',
  };
  return details[code] || 'Cobalt 解析失败：' + code;
}
export function codecFallback(options, result) {
  if (options.youtubeVideoCodec !== 'h264' && result?.error?.code === 'error.api.youtube.no_matching_format') {
    return {...options, youtubeVideoCodec:'h264', youtubeVideoContainer:'auto'};
  }
  return null;
}
