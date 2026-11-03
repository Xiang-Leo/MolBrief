import {randomUUID} from 'node:crypto';
const iso=time=>new Date(time).toISOString(),LEASE_MS=6*60*1000;
export class SummaryJobStore{
  constructor({database,now=Date.now}){this.database=database;this.now=now;}
  recover(){this.database.prepare("UPDATE summary_jobs SET status='failed',finished_at=?,error='上次解读进程中断，未自动重复计费；请重新发起。',lease_token=NULL,lease_expires_at=NULL WHERE status='running' AND lease_expires_at<=?").bind(iso(this.now()),iso(this.now())).run();}
  get(id){
    this.recover();
    const row=this.database.prepare('SELECT id,article_id,status,created_at,started_at,finished_at,error FROM summary_jobs WHERE id=?').bind(id).first();
    return row?{id:row.id,articleId:row.article_id,status:row.status,createdAt:row.created_at,startedAt:row.started_at,finishedAt:row.finished_at,error:row.error}:null;
  }
  enqueue(article){
    this.recover();
    const id='summary-'+randomUUID();
    this.database.prepare("INSERT OR IGNORE INTO summary_jobs(id,article_id,payload_json,status,created_at) VALUES(?,?,?,'queued',?)").bind(id,article.id,JSON.stringify(article),iso(this.now())).run();
    const row=this.database.prepare("SELECT id FROM summary_jobs WHERE article_id=? AND status IN ('queued','running')").bind(article.id).first();
    return this.get(row.id);
  }
  active(){return !!this.database.prepare("SELECT id FROM summary_jobs WHERE status='running' AND lease_expires_at>?").bind(iso(this.now())).first();}
  async tick(adapters){
    this.recover();
    if(this.active())return {busy:true};
    const row=this.database.prepare("SELECT * FROM summary_jobs WHERE status='queued' ORDER BY created_at,rowid LIMIT 1").first();
    if(!row)return {processed:false};
    const token=randomUUID(),now=iso(this.now());
    const claimed=this.database.prepare("UPDATE summary_jobs SET status='running',started_at=?,lease_token=?,lease_expires_at=? WHERE id=? AND status='queued' AND NOT EXISTS(SELECT 1 FROM summary_jobs WHERE status='running' AND lease_expires_at>?) AND NOT EXISTS(SELECT 1 FROM collection_state WHERE lease_token IS NOT NULL AND lease_expires_at>?)").bind(now,token,iso(this.now()+LEASE_MS),row.id,now,now).run();
    if(!claimed.meta.changes)return {busy:true};
    try{
      const original=JSON.parse(row.payload_json);
      const generated=await adapters.summarize(original);
      const owns=this.database.prepare("SELECT id FROM summary_jobs WHERE id=? AND status='running' AND lease_token=? AND lease_expires_at>?").bind(row.id,token,iso(this.now())).first();
      if(!owns)return {processed:true};
      const written=await adapters.write(original,generated);
      this.database.prepare("UPDATE summary_jobs SET status=?,finished_at=?,error=?,lease_token=NULL,lease_expires_at=NULL WHERE id=? AND lease_token=? AND status='running'").bind(written?'done':'failed',iso(this.now()),written?'':'资料已更新，本次未覆盖新内容，请重新生成。',row.id,token).run();
    }catch(error){
      const message=adapters.safeError?.(error)||'中文解读未完成，原始内容已保留，请稍后重试。';
      this.database.prepare("UPDATE summary_jobs SET status='failed',finished_at=?,error=?,lease_token=NULL,lease_expires_at=NULL WHERE id=? AND lease_token=? AND status='running'").bind(iso(this.now()),message,row.id,token).run();
    }
    return {processed:true};
  }
}
