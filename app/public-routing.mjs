export function clientOrigin(host,forwardedProto){if(!/^[A-Za-z0-9.\[\]:_-]+$/.test(host||''))throw Error('Invalid host');return (forwardedProto==='https'?'https':'http')+'://'+host;}
export function rewriteDownloadUrls(json,configuredOrigin,origin,prefix){return configuredOrigin?json.replaceAll(configuredOrigin+'/tunnel',origin+(prefix?'/api/tunnel':'/tunnel')):json;}
