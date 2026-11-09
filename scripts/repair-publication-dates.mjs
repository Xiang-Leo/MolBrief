// Review by default. --apply snapshots SQLite before changing date metadata only.
import{mkdirSync,chmodSync}from'node:fs';import path from'node:path';
import{LocalDatabase}from'../lib/storage-core.mjs';import{safeArticleDate,beijingToday}from'../lib/publication-date.mjs';import{parseEuropePmcArticles}from'../lib/literature-search-core.mjs';
const database=new LocalDatabase(),apply=process.argv.includes('--apply');
try{
 const rows=database.connection.prepare('SELECT id,payload FROM articles').all(),changes=[];
 for(const row of rows){const a=JSON.parse(row.payload);if(!a.publishedAt||a.publishedAt<=beijingToday())continue;
 let next=safeArticleDate(a),verified=false;const pmid=/^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)\/$/.exec(a.url)?.[1];
 if(pmid){try{const u=new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');u.search=new URLSearchParams({query:`EXT_ID:${pmid} AND SRC:MED`,resultType:'core',format:'json'}).toString();const r=await fetch(u,{signal:AbortSignal.timeout(20000),redirect:'error'});if(r.ok){const data=await r.json();const source=parseEuropePmcArticles(data,'date review').find(x=>x.url===a.url);if(source){next={...a,publishedAt:source.publishedAt,publicationInfo:{...source.publicationInfo,reportedDate:a.publishedAt,note:source.publishedAt?'已核对 Europe PMC 的在线 / 期刊发表日期，原始卷期日期保留。':'原始卷期日期在未来；来源未给出可核实的完整在线日期。'}};verified=true;}}}catch{/* Keep unknown instead of guessing. */}}
 changes.push({row,next,verified});
 }
 let backup=null;if(apply&&changes.length){const folder=path.join(database.paths.root,'backups');mkdirSync(folder,{recursive:true,mode:0o700});backup=path.join(folder,'before-date-repair-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sqlite');database.snapshotTo(backup);chmodSync(backup,0o600);}
 let written=0;for(const c of changes)if(apply)written+=database.connection.prepare('UPDATE articles SET payload=? WHERE id=? AND payload=?').run(JSON.stringify(c.next),c.row.id,c.row.payload).changes;
 console.log(JSON.stringify({apply,backup,reviewed:changes.length,written,changes:changes.map(c=>({id:c.row.id,old:JSON.parse(c.row.payload).publishedAt,publishedAt:c.next.publishedAt,officialRecordRead:c.verified}))}));
}finally{database.close();}
