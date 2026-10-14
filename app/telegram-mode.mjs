export const TELEGRAM_LOCAL_API='http://telegram-api:8081';
export const telegramApiBase=local=>local?TELEGRAM_LOCAL_API:'https://api.telegram.org';

// Persist the completed logout before contacting the new endpoint. Restarting after
// an interrupted login must not log out the newly established local session again.
export async function migrateTelegramMode({local,botId,previous,request,save}){
 const mode=local?'local':'cloud';
 const old=previous?.botId===botId?previous.mode:'cloud';
 if(old!==mode){
  try{await request(old,'logOut');}catch(e){if(e.code!==401)throw e;}
 }
 const next={botId,mode};await save(next);return next;
}
