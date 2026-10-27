import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, cp, mkdir, readFile, rm, access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root=process.cwd();
const standalone=path.join(root,'.next','standalone');
await access(path.join(standalone,'server.js'));
await mkdir(path.join(standalone,'.next'),{recursive:true});
await cp(path.join(root,'public'),path.join(standalone,'public'),{recursive:true});
await cp(path.join(root,'.next','static'),path.join(standalone,'.next','static'),{recursive:true});
await cp(path.join(root,'drizzle'),path.join(standalone,'drizzle'),{recursive:true});
const temporary=await mkdtemp(path.join(tmpdir(),'molbrief-production-smoke-'));
const listener=createServer();
await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
const port=listener.address().port;
await new Promise(resolve=>listener.close(resolve));
const origin='http://127.0.0.1:'+port;
const password=randomBytes(24).toString('hex');
const salt=randomBytes(16);
const passwordHash='scrypt:'+salt.toString('hex')+':'+scryptSync(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024}).toString('hex');
const serviceToken=randomBytes(32).toString('hex');
const environment={...process.env,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',HOSTNAME:'127.0.0.1',PORT:String(port),APP_ORIGIN:origin,ADMIN_USERNAME:'smoke-owner',ADMIN_PASSWORD_HASH:passwordHash,SESSION_SECRET:randomBytes(32).toString('hex'),INGEST_API_TOKEN:serviceToken,DATA_DIR:path.join(temporary,'var'),MIGRATIONS_DIR:path.join(root,'drizzle'),PARALLEL_API_KEY:'',LLM_API_KEY:'',LLM_BASE_URL:'',LLM_MODEL:'',MINIMAX_API_KEY:'',MINIMAX_VOICE_ID:''};
let server,logs='',cookie='',checks=0;
function pass(name){checks++;console.log('PASS '+name);}
async function request(route,{body,method=body?'POST':'GET',session=false,service=false,headers={}}={}){
  return fetch(origin+route,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(session?{Cookie:cookie}:{}),...(service?{Authorization:'Bearer '+serviceToken}:{}),...headers},body:body?JSON.stringify(body):undefined,redirect:'manual',signal:AbortSignal.timeout(15000)});
}
async function start(){
  server=spawn(process.execPath,[path.join(standalone,'server.js')],{cwd:standalone,env:environment,stdio:['ignore','pipe','pipe']});
  for(const stream of [server.stdout,server.stderr])stream.on('data',data=>{logs=(logs+data.toString()).slice(-15000)});
  for(let attempt=0;attempt<100;attempt++){
    if(server.exitCode!==null)throw new Error('Production server exited before readiness.');
    try{if((await request('/api/health')).status===200)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Production server did not become ready.');
}
async function stop(){
  if(!server||server.exitCode!==null)return;
  const running=server;
  await new Promise(resolve=>{
    const timer=setTimeout(()=>running.kill('SIGKILL'),5000);
    running.once('exit',()=>{clearTimeout(timer);resolve();});running.kill('SIGTERM');
  });
}
try{
  await start();pass('standalone server starts with SQLite migrations');
  let response=await request('/');assert.ok([302,303,307].includes(response.status));assert.ok(response.headers.get('location')?.endsWith('/login'));pass('home requires the independent account');
  response=await request('/login');assert.equal(response.status,200);assert.ok((await response.text()).includes('账号'));pass('login form renders');
  response=await request('/api/feed',{headers:{'oai-authenticated-user-id':'fake','oai-authenticated-user-email':'fake@example.com'}});assert.equal(response.status,401);pass('old hosting identity headers cannot authenticate');
  response=await request('/api/session',{body:{username:'smoke-owner',password:'incorrect'}});assert.equal(response.status,401);
  response=await request('/api/session',{body:{username:'smoke-owner',password},headers:{Origin:origin}});assert.equal(response.status,200);assert.ok(response.headers.get('set-cookie')?.includes('HttpOnly'));cookie=response.headers.get('set-cookie').split(';')[0];pass('password login sets an HttpOnly session');
  response=await request('/api/state',{session:true});let state=await response.json();assert.equal(response.status,200);assert.equal(state.signedIn,true);assert.equal(state.topics.length,4);assert.equal(state.capabilities.llm,false);pass('owner preferences initialize once and APIs remain unconfigured');
  response=await request('/api/feed',{session:true});const feed=await response.json();assert.equal(response.status,200);assert.equal(feed.articles.length,8);const article=feed.articles[0];pass('eight source-backed articles are readable');
  response=await request('/api/reading',{session:true,body:{articleId:article.id,action:'save',value:true}});assert.equal(response.status,200);assert.ok((await response.json()).saved.includes(article.id));pass('bookmark persists through the API');
  response=await request('/api/preferences',{session:true,body:{speed:1.2}});assert.equal(response.status,200);assert.equal((await response.json()).preferences.speed,1.2);pass('reading preference updates persist');
  response=await request('/api/topics',{session:true,body:{action:'add',name:'Smoke temporary topic'}});state=await response.json();assert.equal(response.status,200);const topic=state.topics.find(item=>item.name==='Smoke temporary topic');assert.ok(topic);
  response=await request('/api/topics',{session:true,body:{action:'remove',id:topic.id}});assert.equal(response.status,200);assert.ok(!(await response.json()).topics.some(item=>item.id===topic.id));pass('topic creation and removal work');
  response=await request('/api/preferences',{session:true,body:{speed:999}});assert.equal(response.status,400);pass('invalid preference data is rejected');
  response=await request('/api/reading',{session:true,body:{articleId:article.id,action:'save',value:false},headers:{Origin:'https://different.example'}});assert.equal(response.status,403);pass('cross-origin mutations are rejected');
  response=await request('/api/state',{headers:{Cookie:cookie+'x'}});assert.equal(response.status,401);pass('tampered cookies are rejected');
  response=await request('/api/search',{session:true,body:{query:'nanobody',source:'web'}});assert.equal(response.status,501);pass('missing paid service returns an explicit configuration state');
  response=await request('/api/ingest',{session:true,body:{articles:[article]}});assert.equal(response.status,401);
  const exported=JSON.parse(await readFile(path.join(root,'data','content-export.json'),'utf8'));
  response=await request('/api/ingest',{service:true,body:{articles:exported.articles}});assert.equal(response.status,200);assert.equal((await response.json()).written,8);
  response=await request('/api/feed',{service:true});assert.equal(response.status,200);assert.equal((await response.json()).articles.length,8);pass('service import and deduplicated readback work');
  response=await request('/api/reading',{service:true,body:{articleId:article.id,action:'save',value:false}});assert.equal(response.status,401);
  response=await request('/api/state',{service:true});assert.equal(response.status,401);pass('service tokens cannot act as the owner');
  response=await request('/api/update-guide',{service:true});assert.equal(response.status,200);assert.ok((await response.json()).requiredFields.includes('readingBasis'));pass('unattended update instructions are available with service authorization');
  response=await request('/manifest.webmanifest');assert.equal(response.status,200);const manifest=await response.json();assert.ok(manifest.icons.some(icon=>icon.sizes==='192x192'));
  response=await request('/icon-192.png');assert.equal(response.status,200);
  response=await request('/',{session:true});assert.equal(response.status,200);const html=await response.text();assert.ok(html.includes('今天，读一点新进展'));const css=html.match(/href="([^\"]*\/_next\/static\/[^\"]+\.css[^\"]*)"/);assert.ok(css);response=await request(css[1].replaceAll('&amp;','&'));assert.equal(response.status,200);pass('home HTML, styles and PWA assets are served by the standalone bundle');
  await stop();await start();response=await request('/api/state',{session:true});state=await response.json();assert.equal(response.status,200);assert.ok(state.saved.includes(article.id));assert.equal(state.preferences.speed,1.2);assert.equal(state.topics.length,4);pass('bookmarks and preferences survive a process restart');
  response=await request('/api/session',{session:true,body:{action:'logout'},headers:{Origin:origin}});assert.equal(response.status,200);assert.ok(response.headers.get('set-cookie')?.toLowerCase().includes('max-age=0'));pass('logout clears the browser session cookie');
  const backup=spawn(process.execPath,['scripts/backup.mjs',path.join(temporary,'backups')],{cwd:root,env:environment,stdio:['ignore','pipe','pipe']});let output='';backup.stdout.on('data',data=>output+=data);const exit=await new Promise(resolve=>backup.once('exit',resolve));assert.equal(exit,0);const result=JSON.parse(output);await access(path.join(result.destination,'molbrief.sqlite'));const metadata=JSON.parse(await readFile(path.join(result.destination,'backup.json'),'utf8'));assert.equal(metadata.includesSecrets,false);pass('backup command creates a database snapshot without secrets');
  console.log(JSON.stringify({productionSmoke:'passed',checks,paidApiCalls:0,dockerEngineTested:false}));
}catch(error){console.error('SMOKE FAILURE:',error.message);console.error(logs.slice(-1600));process.exitCode=1;}
finally{await stop();await rm(temporary,{recursive:true,force:true});}
