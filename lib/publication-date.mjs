/** Publication dates are source facts. Never replace them with collection time. */
export function exactDay(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const d=new Date(value+'T00:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===value?value:null;
}
export function beijingToday(now=Date.now()) {return new Date(now+8*3600000).toISOString().slice(0,10);}
/** @param {{online?:string|null,journal?:string|null,reported?:string|null,basis?:string}} input */
export function publicationDates({online=null,journal=null,reported=null,basis='source'},now=Date.now()) {
  const today=beijingToday(now),electronic=exactDay(online),issue=exactDay(journal),source=exactDay(reported);
  const chosen=electronic&&electronic<=today?electronic:issue&&issue<=today?issue:source&&source<=today?source:null;
  const future=[electronic,issue,source].some(d=>d&&d>today);
  return {publishedAt:chosen,publicationInfo:{basis:chosen?(chosen===electronic?'online':chosen===issue?'journal':basis):'unknown',reportedDate:reported||online||null,journalDate:journal||null,...(future?{note:chosen?'已采用在线或已发表日期；未来卷期日期仅供核对。':'来源含未来日期，实际发表日待核实；未用采集时间替代。'}:{})}};
}
export function safeArticleDate(article,now=Date.now()) {
  if(!article.publishedAt||exactDay(article.publishedAt)&&article.publishedAt<=beijingToday(now))return article;
  return {...article,...publicationDates({reported:article.publishedAt,journal:article.publicationInfo?.journalDate},now),publicationInfo:{...article.publicationInfo,basis:'unknown',reportedDate:article.publishedAt,note:'来源日期在未来或格式无效，实际发表日待核实。'}};
}
