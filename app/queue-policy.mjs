import fs from 'node:fs';
import path from 'node:path';
import {alreadyPublished} from './naming.mjs';

export const activeStates=new Set(['queued','resolving','downloading','checking']);
export function ensureQueueCapacity(jobs){
 if(jobs.filter(j=>activeStates.has(j.state)).length>=50)throw Object.assign(Error('队列已满，请等待现有任务完成'),{status:429});
}
export function canAccessJob(job,user,categories){
 return job.owner===user.username&&(!(job.private||categories.find(c=>c.id===job.category)?.private)||user.private);
}
export function completedFileExists(job,root){
 if(job.state!=='completed'||!job.target||path.dirname(job.target)!==root)return false;
 if(job.publishing)return alreadyPublished(job);
 // Old records lack publication identity. Still require a regular file with its recorded size.
 try{const st=fs.lstatSync(job.target);return st.isFile()&&st.size>0&&st.size===job.bytes;}catch{return false;}
}
