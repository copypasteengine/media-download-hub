import path from 'node:path';
export const attachmentLabels={video:'视频',image:'图片',document:'电子文档',audio:'音乐与语音',file:'其它文件'};
const types={
 video:['mp4','mkv','webm','mov','m4v','avi','ts','mts','m2ts','flv','wmv','mpeg','mpg','3gp'],
 image:['jpg','jpeg','png','gif','webp','heic','heif','avif','bmp','tif','tiff','svg','ico','dng','raw'],
 audio:['mp3','m4a','aac','flac','alac','wav','ogg','opus','aiff','aif','wma','ape','amr','mid','midi'],
 document:['pdf','epub','mobi','azw','azw3','djvu','txt','md','rtf','doc','docx','odt','xls','xlsx','ods','csv','ppt','pptx','odp','pages','numbers','key','tex']
};
export function attachmentKind(filename,mime=''){
 const ext=path.extname(filename||'').slice(1).toLowerCase();
 for(const [kind,list] of Object.entries(types))if(list.includes(ext))return kind;
 // A named unknown format remains a generic file: never disguise it via a MIME claim.
 if(ext)return 'file';
 if(mime.startsWith('video/'))return 'video';if(mime.startsWith('image/'))return 'image';if(mime.startsWith('audio/'))return 'audio';
 if(mime.startsWith('text/')||['application/pdf','application/epub+zip'].includes(mime))return 'document';return 'file';
}
export function attachmentExtension(mime,kind){
 return ({'image/png':'.png','image/webp':'.webp','image/gif':'.gif','image/heic':'.heic','image/avif':'.avif','audio/ogg':'.ogg','audio/opus':'.opus','audio/flac':'.flac','audio/mp4':'.m4a','audio/wav':'.wav','application/pdf':'.pdf','application/epub+zip':'.epub','text/plain':'.txt','text/csv':'.csv','video/webm':'.webm'})[mime]||({video:'.mp4',image:'.jpg',audio:'.mp3',document:'.txt',file:'.bin'})[kind];
}
export function recommendedCategory(categories,kind){
 if(!kind||kind==='video')return null;
 const matches=categories.filter(c=>c.enabled!==false&&(c.attachmentTypes||[]).includes(kind));
 return matches.length===1?matches[0]:null;
}
