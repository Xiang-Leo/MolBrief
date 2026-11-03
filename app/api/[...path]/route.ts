import { z } from "zod";
import { verifyServiceToken } from "@/lib/auth";
import { readAudioObject } from "@/lib/local-storage";
import {
  addTopic, AppError, articleSchema, canonicalUrl, cloudAudio, db, errorResponse,
  getArticles, getState, ingest, pubmedSearch, readBody,
  savePreferences, signedIn, updateReading, verifyOrigin, webSearch,
} from "@/lib/molbrief-server";
import type { Article } from "@/lib/molbrief-types";
import { buildKnowledgeDirectory } from "@/lib/knowledge-core";
import { mergeArticleEvidence } from "@/lib/article-merge";
import {enqueueSummary,summaryStatus} from '@/lib/summary-server';

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const pathname = (r:Request) => new URL(r.url).pathname.replace(/^\/api\//,"");
export async function GET(request:Request) {
  try {
    const path=pathname(request);
    if(path==="health") {
      try {
        db().prepare("SELECT 1 AS ready").first();
        return Response.json({status:"ok"},{headers:{"Cache-Control":"no-store"}});
      } catch {
        return Response.json({status:"unavailable"},{status:503,headers:{"Cache-Control":"no-store"}});
      }
    }
    if(path==="feed") {
      const service=verifyServiceToken(request);
      if(!service) await signedIn();
      return Response.json({articles:await getArticles({userScoped:!service})},{headers:{"Cache-Control":"private, no-store"}});
    }
    if(path==="state") {
      await signedIn();
      return Response.json(await getState(),{headers:{"Cache-Control":"private, no-store"}});
    }
    if(path.startsWith('summary-status/')){await signedIn();return Response.json(await summaryStatus(path.slice('summary-status/'.length)),{headers:{'Cache-Control':'private, no-store'}});}
    if(path==="knowledge") {
      await signedIn();
      return Response.json(buildKnowledgeDirectory(await getArticles()),{headers:{"Cache-Control":"private, no-store"}});
    }
    if(path==="update-guide") {
      if(!verifyServiceToken(request)) await signedIn();
      const topics=await db().prepare("SELECT DISTINCT name,query,kind FROM topics WHERE user_id='owner' AND (expires_at IS NULL OR expires_at>?) LIMIT 40").bind(new Date().toISOString()).all();
      return Response.json({
        title:"研览 · MolBrief",topics:topics.results,
        instruction:"检索药企、药物、AI制药、抗体设计的重要进展。优先官方公告与原始研究。保持原始发表日期，旧文归延伸阅读。每条中文摘要须有真实可打开来源，明确公告/预印本/摘要的证据范围。不要把试验预告当成结果，不要把计算筛选当成实验验证。用 POST /api/ingest 写入，GET /api/feed 读回核对。无需重新发布网站。",
        requiredFields:["title","category","publishedAt","url","source","type","summary","keyPoints","limitations","topics","readingBasis","group"],
        categories:["产业","临床","研究","工具"],maxPerUpdate:12,
      },{headers:{"Cache-Control":"private, no-store"}});
    }
    if(path.startsWith("audio/")) {
      await signedIn();
      const id=path.slice(6);
      if(!/^[a-f0-9]{64}$/.test(id)) throw new AppError("音频不存在。",404);
      const row=await db().prepare("SELECT object_key FROM audio_assets WHERE id=?").bind(id).first<{object_key:string}>();
      if(!row) throw new AppError("音频不存在。",404);
      const file=await readAudioObject(row.object_key);
      if(!file) throw new AppError("音频暂不可用，请重新生成。",404);
      return new Response(file,{headers:{"Content-Type":"audio/mpeg","Content-Length":String(file.byteLength),"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
    }
    throw new AppError("未找到这个入口。",404);
  } catch(e) { return errorResponse(e); }
}
export async function POST(request:Request) {
  try {
    verifyOrigin(request);
    const path=pathname(request);
    if(path==="ingest") {
      if(!verifyServiceToken(request)) throw new AppError("后台写入需要有效的服务令牌。",401);
      const input=await readBody(request);
      const body=z.object({articles:z.array(z.unknown()).max(30)}).parse(input);
      return Response.json({written:await ingest(body.articles)});
    }
    await signedIn();
    const input=await readBody(request);
    if(path==="article") {
      const item=articleSchema.parse(input.article);
      const url=canonicalUrl(item.url);
      const existing=(await getArticles()).find(a=>a.url===url);
      await ingest([mergeArticleEvidence(existing,{...item,url,id:existing?.id||"",collectedAt:new Date().toISOString()} as Article)]);
      const article=(await getArticles()).find(a=>a.url===url);
      if(!article)throw new AppError("资料保存后未能读回，请刷新重试。",500);
      return Response.json({article},{headers:{"Cache-Control":"private, no-store"}});
    }
    if(path==="reading") {
      const body=z.object({articleId:z.string().max(120),action:z.enum(["save","read"]),value:z.boolean()}).parse(input);
      return Response.json(await updateReading(body.articleId,body.action,body.value));
    }
    if(path==="topics") {
      const body=z.object({action:z.enum(["add","remove","promote","update"]),id:z.string().max(200).optional(),name:z.string().max(70).optional(),query:z.string().max(500).optional(),kind:z.enum(["core","explore"]).optional(),reason:z.string().max(300).optional()}).parse(input);
      const user=await signedIn();
      if(body.action==="remove"&&body.id) await db().prepare("DELETE FROM topics WHERE id=? AND user_id=?").bind(body.id,user.userId).run();
      else if(body.action==="promote"&&body.id) await db().prepare("UPDATE topics SET kind='core',expires_at=NULL WHERE id=? AND user_id=?").bind(body.id,user.userId).run();
      else if(body.action==="update"&&body.id&&body.query?.trim()) {
        const result=db().prepare("UPDATE topics SET query=? WHERE id=? AND user_id=?").bind(body.query.trim(),body.id,user.userId).run();
        if(!result.meta.changes)throw new AppError("这个关注主题不存在，请刷新后重试。",404);
      }
      else if(body.action==="add"&&body.name) return Response.json(await addTopic({...body,name:body.name}));
      else throw new AppError("请选择要修改的主题。");
      return Response.json(await getState());
    }
    if(path==="preferences") return Response.json(await savePreferences(input));
    if(path==="search") {
      const body=z.object({query:z.string().trim().min(1).max(500),source:z.enum(["pubmed","web"]),explore:z.boolean().optional(),topic:z.string().max(70).optional()}).parse(input);
      const results=body.source==="pubmed"?await pubmedSearch(body.query):await webSearch(body.query);
      if(body.explore&&body.topic&&results.length) {
        const state=await getState();
        if(state.preferences.autoExplore) {
          try { await addTopic({name:body.topic,query:body.query,kind:"explore",reason:"通过探索搜索发现相关资料，试用 14 天"}); } catch { /* keep search results when topic cap is reached */ }
        }
      }
      return Response.json({articles:results,source:body.source});
    }
    if(path==="collect") {
      const item=articleSchema.parse(input.article);
      const url=canonicalUrl(item.url);
      if(!(await getArticles()).some(a=>a.url===url))await ingest([item]);
      const article=(await getArticles()).find(a=>a.url===url);
      if(!article)throw new AppError("资料保存后未能读回，请刷新重试。",500);
      return Response.json({...await updateReading(article.id,"save",true),article});
    }
    if(path==="summarize") {
      return Response.json(await enqueueSummary(input.article),{status:202,headers:{'Cache-Control':'private, no-store'}});
    }
    if(path==="audio") {
      const body=z.object({articleId:z.string().max(120)}).parse(input);
      const article=(await getArticles()).find(a=>a.id===body.articleId);
      if(!article) throw new AppError("请先收录这篇内容，再生成音频。",404);
      return Response.json(await cloudAudio(article));
    }
    throw new AppError("未找到这个入口。",404);
  } catch(e) { return errorResponse(e); }
}
