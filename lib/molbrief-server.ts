import { z } from "zod";
import { AuthError, assertSameOrigin, getCurrentUser } from "./auth";
import { audioObjectExists, getDatabase, writeAudioObject } from "./local-storage";
import { getServiceRuntime } from "./service-config";
import { articleSchema as editorialArticleSchema, buildSummaryRequest, mergeModelSummary, SummaryOutputError } from "./editorial-schema";
import { searchLiterature, LiteratureSearchError } from "./literature-search-core.mjs";
import seedData from "@/data/seed.json";
import { Article, DEFAULT_PREFERENCES, Preferences, STARTER_TOPICS, Topic } from "./molbrief-types";

type Runtime = NodeJS.ProcessEnv & {
  PARALLEL_API_KEY?: string;
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  MINIMAX_API_KEY?: string;
  MINIMAX_VOICE_ID?: string;
  MINIMAX_MODEL?: string;
  CODEX_GATEWAY_URL?: string;
  CODEX_GATEWAY_TOKEN?: string;
};
export const runtime = () => getServiceRuntime() as Runtime;
export const db = getDatabase;
export const capabilities = () => ({
  parallel: !!runtime().PARALLEL_API_KEY,
  llm: !!(runtime().LLM_API_KEY && runtime().LLM_BASE_URL && runtime().LLM_MODEL),
  tts: !!(runtime().MINIMAX_API_KEY && runtime().MINIMAX_VOICE_ID),
  codex: false,
});
export class AppError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function errorResponse(error: unknown) {
  if (error instanceof AppError || error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof z.ZodError) return Response.json({ error: "输入格式不正确，请检查后重试。" }, { status: 400 });
  console.error("MolBrief request failed", error instanceof Error ? error.name : "unknown");
  return Response.json({ error: "这次操作未完成，已有内容不会受影响。请稍后重试。" }, { status: 500 });
}
export async function signedIn() {
  const user = await getCurrentUser();
  if (!user) throw new AppError("请先登录，以同步收藏和关注。", 401);
  return user;
}
export const verifyOrigin = assertSameOrigin;
export async function readBody(request: Request, max = 120000) {
  if (Number(request.headers.get("content-length") || 0) > max) throw new AppError("提交内容过长。", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("请求内容不是有效的 JSON。", 400);
  let raw = "", bytes = 0;
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > max) { await reader.cancel(); throw new AppError("提交内容过长。", 413); }
      raw += decoder.decode(chunk.value, {stream:true});
    }
    raw += decoder.decode();
  } finally { reader.releaseLock(); }
  try { return JSON.parse(raw); } catch { throw new AppError("请求内容不是有效的 JSON。",400); }
}
export function canonicalUrl(input: string) {
  const u = new URL(input);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new AppError("仅支持网页链接。");
  if (u.username || u.password) throw new AppError("链接不能包含账号信息。");
  ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid"].forEach((k) => u.searchParams.delete(k));
  u.hash = "";
  return u.href;
}
export async function hash(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))))
    .map((x) => x.toString(16).padStart(2, "0")).join("");
}
export const articleSchema = editorialArticleSchema;
export async function getArticles({ userScoped = true }: {userScoped?:boolean} = {}): Promise<Article[]> {
  const user = userScoped ? await getCurrentUser() : null;
  const query = user
    ? db().prepare("SELECT payload FROM articles WHERE id IN (SELECT id FROM articles ORDER BY collected_at DESC LIMIT 200) OR id IN (SELECT article_id FROM reading_state WHERE user_id=? AND saved=1) ORDER BY collected_at DESC").bind(user.userId)
    : db().prepare("SELECT payload FROM articles ORDER BY collected_at DESC LIMIT 200");
  const rows = await query.all<{ payload: string }>();
  const combined = new Map<string, Article>();
  for (const a of seedData as Article[]) combined.set(a.url, a);
  for (const r of rows.results) {
    try { const a = JSON.parse(r.payload) as Article; combined.set(a.url, a); } catch { /* isolated bad row */ }
  }
  return [...combined.values()].sort((a,b) => (b.publishedAt || "0000").localeCompare(a.publishedAt || "0000"));
}
export async function ingest(values: unknown[]) {
  const now = new Date().toISOString();
  const parsed = values.map((x) => articleSchema.parse(x));
  const statements = [];
  for (const item of parsed) {
    const url = canonicalUrl(item.url);
    const id = "art-" + (await hash(url)).slice(0, 16);
    const a: Article = { ...item, id, url, collectedAt: now };
    statements.push(db().prepare("INSERT INTO articles (id, canonical_url, payload, collected_at) VALUES (?, ?, ?, ?) ON CONFLICT(canonical_url) DO UPDATE SET payload=excluded.payload, collected_at=excluded.collected_at")
      .bind(id, url, JSON.stringify(a), now));
  }
  if (statements.length) await db().batch(statements);
  return parsed.length;
}
export async function getState() {
  const user = await getCurrentUser();
  const base = {
    signedIn: !!user, displayName: user?.displayName || "我的研览",
    saved: [] as string[], read: [] as string[], topics: [] as Topic[],
    preferences: DEFAULT_PREFERENCES, capabilities: capabilities(),
  };
  if (!user) return base;
  const prefRow = await db().prepare("SELECT payload FROM preferences WHERE user_id=?").bind(user.userId).first<{payload:string}>();
  if (!prefRow) {
    const now = new Date().toISOString();
    await db().batch([
      db().prepare("INSERT OR IGNORE INTO preferences(user_id,payload) VALUES(?,?)").bind(user.userId,JSON.stringify(DEFAULT_PREFERENCES)),
      ...STARTER_TOPICS.map((t, i) => db().prepare("INSERT OR IGNORE INTO topics(id,user_id,name,query,kind,reason,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)")
        .bind(user.userId+"-seed-"+i,user.userId,t.name,t.query,"core","初始关注，可随时调整",now,null)),
    ]);
  } else {
    try { base.preferences = {...DEFAULT_PREFERENCES,...JSON.parse(prefRow.payload)}; } catch { /* use defaults */ }
  }
  const [readRows, topicRows] = await Promise.all([
    db().prepare("SELECT article_id,saved,read FROM reading_state WHERE user_id=?").bind(user.userId).all<{article_id:string,saved:number,read:number}>(),
    db().prepare("SELECT id,name,query,kind,reason,created_at,expires_at FROM topics WHERE user_id=? AND (expires_at IS NULL OR expires_at>?) ORDER BY created_at ASC").bind(user.userId,new Date().toISOString()).all(),
  ]);
  base.saved = readRows.results.filter((r)=>r.saved).map((r)=>r.article_id);
  base.read = readRows.results.filter((r)=>r.read).map((r)=>r.article_id);
  base.topics = topicRows.results.map((r:any)=>({id:r.id,name:r.name,query:r.query,kind:r.kind,reason:r.reason,createdAt:r.created_at,expiresAt:r.expires_at}));
  return base;
}
export async function updateReading(articleId: string, action: "save" | "read", value: boolean) {
  const u=await signedIn();
  const field=action==="save"?"saved":"read";
  await db().prepare("INSERT INTO reading_state(user_id,article_id,"+field+") VALUES(?,?,?) ON CONFLICT(user_id,article_id) DO UPDATE SET "+field+"=excluded."+field)
    .bind(u.userId,articleId,value?1:0).run();
  return getState();
}
export async function addTopic(input: {name:string,query?:string,kind?:string,reason?:string}) {
  const u=await signedIn();
  const name=input.name.trim().slice(0,70);
  if (!name) throw new AppError("请输入关注的主题。");
  const current=await getState();
  if(current.topics.some((t)=>t.name.toLowerCase()===name.toLowerCase())) return current;
  const kind=input.kind==="explore"?"explore":"core";
  if(kind==="explore" && current.topics.filter((t)=>t.kind==="explore").length>=10) throw new AppError("探索主题已达 10 个，请先整理已有主题。");
  if(current.topics.length>=40) throw new AppError("关注主题已达 40 个，请先整理。");
  const now=new Date();
  await db().prepare("INSERT INTO topics(id,user_id,name,query,kind,reason,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(),u.userId,name,(input.query||name).slice(0,500),kind,(input.reason||"手动关注").slice(0,300),now.toISOString(),kind==="explore"?new Date(now.getTime()+14*86400000).toISOString():null).run();
  return getState();
}
export async function savePreferences(input: Partial<Preferences>) {
  const u=await signedIn(); const state=await getState();
  const valid=z.object({
    autoExplore:z.boolean().optional(),voiceUri:z.string().max(500).optional(),
    speed:z.number().min(0.7).max(2).optional(),audioMode:z.enum(["device","cloud"]).optional(),
    explorationRatio:z.number().min(0).max(40).optional(),
  }).parse(input);
  await db().prepare("UPDATE preferences SET payload=? WHERE user_id=?").bind(JSON.stringify({...state.preferences,...valid}),u.userId).run();
  return getState();
}
function plain(xml: string) {
  return xml.replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/\s+/g," ").trim();
}
async function remote(url:string, init:RequestInit={}, timeout=25000) {
  const response=await fetch(url,{...init,signal:AbortSignal.timeout(timeout),redirect:"error"});
  if(!response.ok) throw new AppError("外部服务暂未完成请求（"+response.status+"），请稍后重试。",502);
  return response;
}
export async function pubmedSearch(query:string):Promise<Article[]> {
  try { return await searchLiterature(query) as Article[]; }
  catch(error) {
    if(error instanceof LiteratureSearchError) throw new AppError(error.message,error.status);
    throw new AppError("文献检索暂未完成，请稍后重试。",502);
  }
}
export async function webSearch(query:string):Promise<Article[]> {
  const key=runtime().PARALLEL_API_KEY;
  if(!key) throw new AppError("联网发现需要先连接 Parallel。你现在可以使用 PubMed 论文搜索。",501);
  const data=await (await remote("https://api.parallel.ai/v1/search",{
    method:"POST",headers:{"Content-Type":"application/json","x-api-key":key},
    body:JSON.stringify({objective:"Find recent pharmaceutical, drug research, or AI drug discovery information about: "+query+". Prefer original company announcements, regulator documents and original research. Preserve original dates.",search_queries:[query],mode:"fast"}),
  })).json() as any;
  const out:Article[]=[];
  for(const item of (data.results||[]).slice(0,8)) {
    if(!item.url||!item.title) continue;
    const url=canonicalUrl(item.url);
    const abstract=(item.excerpts||[]).join("\n").slice(0,9000)||"请打开原文查看详情。";
    out.push({id:"art-"+(await hash(url)).slice(0,16),title:item.title,category:"产业",
      publishedAt:/^\d{4}-\d{2}-\d{2}/.test(item.publish_date||"")?item.publish_date.slice(0,10):null,
      url,source:new URL(url).hostname,type:"网页检索",summary:abstract,keyPoints:[],
      limitations:"目前基于搜索摘录；来源观点与关键数据仍需核对原文。",topics:[query.slice(0,60)],
      readingBasis:"搜索结果摘录",group:"检索结果",collectedAt:new Date().toISOString(),coverSource:null});
  }
  return out;
}
export async function summarize(article:Article):Promise<Article> {
  const config=runtime();
  if(!(config.LLM_API_KEY&&config.LLM_BASE_URL&&config.LLM_MODEL)) throw new AppError("中文解读需要先连接摘要模型。原始摘要和来源链接仍可阅读。",501);
  const base=new URL(config.LLM_BASE_URL!);
  if(base.protocol!=="https:"||base.username||base.password||base.search||base.hash) throw new AppError("模型服务地址需为不含账号或查询参数的 HTTPS API 根路径。",500);
  const url=base.href.replace(/\/$/,"")+"/chat/completions";
  const response=await (await remote(url,{
    method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+config.LLM_API_KEY},
    body:JSON.stringify({model:config.LLM_MODEL,...buildSummaryRequest(article)}),
  },60000)).json() as any;
  try { return mergeModelSummary(article,response.choices?.[0]?.message?.content); }
  catch(error) {
    if(error instanceof SummaryOutputError) throw new AppError(error.message,502);
    throw error;
  }
}
export async function cloudAudio(article:Article) {
  if(!capabilities().tts) throw new AppError("云端配音尚未连接，可以先使用设备朗读。",501);
  const conf=runtime();
  const text=article.title+"。\n"+article.summary+"\n"+article.keyPoints.join("。")+"\n阅读提示："+article.limitations;
  const key=await hash(JSON.stringify({text,voice:conf.MINIMAX_VOICE_ID,model:conf.MINIMAX_MODEL||"speech-2.8-turbo",version:1}));
  const row=await db().prepare("SELECT object_key FROM audio_assets WHERE id=?").bind(key).first<{object_key:string}>();
  if(row && await audioObjectExists(row.object_key)) return {id:key,cached:true};
  const runId="audio:"+key;
  const lock=await db().prepare("INSERT INTO runs(id,kind,state,started_at,detail) VALUES(?,'audio','running',?,'') ON CONFLICT(id) DO UPDATE SET state='running',started_at=excluded.started_at WHERE runs.state!='running' OR runs.started_at<?")
    .bind(runId,new Date().toISOString(),new Date(Date.now()-180000).toISOString()).run();
  if(!lock.meta.changes) throw new AppError("这条音频正在生成，请稍后再点收听。",409);
  try {
  const cached=await db().prepare("SELECT object_key FROM audio_assets WHERE id=?").bind(key).first<{object_key:string}>();
  if(cached && await audioObjectExists(cached.object_key)) {
    await db().prepare("UPDATE runs SET state='completed' WHERE id=?").bind(runId).run();
    return {id:key,cached:true};
  }
  const json=await (await remote("https://api.minimax.io/v1/t2a_v2",{
    method:"POST",headers:{Authorization:"Bearer "+conf.MINIMAX_API_KEY,"Content-Type":"application/json"},
    body:JSON.stringify({model:conf.MINIMAX_MODEL||"speech-2.8-turbo",text,stream:false,output_format:"hex",
      voice_setting:{voice_id:conf.MINIMAX_VOICE_ID,speed:1,vol:1,pitch:0},audio_setting:{format:"mp3",sample_rate:32000,bitrate:128000,channel:1}}),
  },60000)).json() as any;
  const audio=json.data?.audio;
  if(json.base_resp?.status_code!==0||typeof audio!=="string"||audio.length%2!==0||!/^[0-9a-f]+$/i.test(audio)) throw new AppError("配音服务未返回有效音频，请检查音色配置。",502);
  const bytes=new Uint8Array(audio.length/2);
  for(let i=0;i<bytes.length;i++) bytes[i]=parseInt(audio.slice(i*2,i*2+2),16);
  const objectKey="audio/"+key+".mp3";
  await writeAudioObject(objectKey,bytes);
  await db().prepare("INSERT OR IGNORE INTO audio_assets(id,object_key,created_at) VALUES(?,?,?)").bind(key,objectKey,new Date().toISOString()).run();
  await db().prepare("UPDATE runs SET state='completed' WHERE id=?").bind(runId).run();
  return {id:key,cached:false};
  } catch(error) {
    await db().prepare("UPDATE runs SET state='failed' WHERE id=?").bind(runId).run();
    throw error;
  }
}
