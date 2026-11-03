import {SummaryJobStore} from './summary-jobs.mjs';
import {AppError,articleSchema,canonicalUrl,capabilities,db,getArticles,ingest,summarize} from './molbrief-server';
import {applyGeneratedSummary} from './article-merge';
import type {Article} from './molbrief-types';
const jobs=()=>new SummaryJobStore({database:db()});
export async function enqueueSummary(value:unknown){
  if(!capabilities().llm)throw new AppError('请先连接中文解读模型。',501);
  const input=articleSchema.parse(value),url=canonicalUrl(input.url);
  let article=(await getArticles()).find(a=>a.url===url);
  if(!db().prepare('SELECT id FROM articles WHERE canonical_url=?').bind(url).first()){await ingest([article||input]);article=(await getArticles()).find(a=>a.url===url);}
  if(!article)throw new AppError('资料未能保存，请重试。',500);
  return {job:jobs().enqueue(article)};
}
export async function summaryStatus(id:string){
  if(!/^summary-[a-f0-9-]{36}$/.test(id))throw new AppError('解读任务不存在。',404);
  const job=jobs().get(id);if(!job)throw new AppError('解读任务不存在。',404);
  const article=job.status==='done'?(await getArticles()).find(a=>a.id===job.articleId):undefined;
  return {job,...(article?{article}:{})};
}
export function manualSummaryActive(){return jobs().active();}
export async function tickManualSummary(){
  return jobs().tick({summarize,safeError:(error:unknown)=>error instanceof AppError?error.message:'中文解读未完成，原始内容已保留，请稍后重试。',
    write:async(original:Article,generated:Article)=>{
      const row=db().prepare('SELECT payload FROM articles WHERE id=?').bind(original.id).first<{payload:string}>();if(!row)return false;
      const current=JSON.parse(row.payload) as Article;
      if(current.title!==original.title||current.summary!==original.summary||current.sourceText!==original.sourceText)return false;
      const next={...articleSchema.parse(applyGeneratedSummary(current,generated)),collectedAt:current.collectedAt};
      return db().prepare('UPDATE articles SET payload=? WHERE id=? AND payload=?').bind(JSON.stringify(next),original.id,row.payload).run().meta.changes===1;
    }});
}
