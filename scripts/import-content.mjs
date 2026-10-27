import { readFile } from 'node:fs/promises';
const filename=process.argv[2]||'data/content-export.json';
const input=JSON.parse(await readFile(filename,'utf8'));
const articles=Array.isArray(input)?input:input.articles;
if(!Array.isArray(articles)||!articles.length)throw new Error('Expected a nonempty articles array.');
const token=process.env.INGEST_API_TOKEN;
if(!token)throw new Error('INGEST_API_TOKEN is required.');
// This command runs on the app host or inside its container; it never needs the public domain.
const origin='http://127.0.0.1:'+(process.env.PORT||'3000');
let written=0;
for(let start=0;start<articles.length;start+=8){
  const response=await fetch(origin+'/api/ingest',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({articles:articles.slice(start,start+8)}),redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error('Import failed: HTTP '+response.status);
  const result=await response.json();written+=result.written;
}
const readback=await fetch(origin+'/api/feed',{headers:{Authorization:'Bearer '+token},redirect:'error'});
if(!readback.ok)throw new Error('Readback failed: HTTP '+readback.status);
const feed=await readback.json();
const urls=new Set(feed.articles.map(article=>article.url));
if(!articles.every(article=>urls.has(article.url)))throw new Error('Some imported URLs were not found on readback.');
console.log(JSON.stringify({written,readbackVerified:true}));
