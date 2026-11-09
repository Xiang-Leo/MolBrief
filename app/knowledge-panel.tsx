"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, BookOpen, ChevronRight, Copy, ExternalLink, Loader2, Plus, Search } from "lucide-react";
import type { Article, Category } from "@/lib/molbrief-types";
import type { ArticleKnowledge, EntityFact, EntityType, FactStatus, KnowledgeEntity, KnowledgeFact } from "@/lib/knowledge-types";
import { buildKnowledgeDirectory, ENTITY_FIELDS, ENTITY_TYPE_LABELS, exactDate, findKnowledgeEntity, knowledgeEntityId, searchKnowledgeEntities, validSourceUrl } from "@/lib/knowledge-core";
import "./knowledge.css";

export type KnowledgePanelProps = {
  articles: Article[];
  initialEntityId?: string;
  onOpenArticle: (article: Article) => void;
  onSaveArticle: (article: Article) => Promise<void>;
};

type FieldInput = { status: FactStatus; value: string };
type ManualInput = {
  url: string; title: string; source: string; date: string; summary: string; sourceText: string;
  category: Category; entityType: EntityType; entityName: string; aliases: string;
};
const blankInput = (): ManualInput => ({ url: "", title: "", source: "", date: "", summary: "", sourceText: "", category: "研究", entityType: "drug", entityName: "", aliases: "" });
const fieldStatusText = (status: FactStatus | "multiple-values") => ({ reported: "来源记载", "not-disclosed": "来源未披露", "not-recorded": "未收录", "multiple-values": "多条来源记录" })[status];
const typeChoices: EntityType[] = ["drug", "target", "deal", "company"];

function sourceName(url: string) {
  try { return new URL(url).hostname; } catch { return "原始来源"; }
}

function EvidenceItem({ fact }: { fact: KnowledgeFact }) {
  return <li className="knowledge-evidence-item">
    <p>{fact.status === "reported" ? fact.value : fieldStatusText(fact.status)}</p>
    {fact.evidence && <p className="knowledge-evidence-context">{fact.evidence}</p>}
    <div className="knowledge-citation">
      <a href={fact.sourceUrl} target="_blank" rel="noopener noreferrer">{sourceName(fact.sourceUrl)} <ExternalLink size={12}/></a>
      <span>{fact.sourceDate ? `${fact.dateBasis === "event" ? "事件日期" : "来源发布日期"} ${fact.sourceDate}` : "来源日期未收录"}</span>
    </div>
    <p className="knowledge-evidence-basis">{fact.readingBasis}</p>
  </li>;
}

export default function KnowledgePanel({ articles, initialEntityId, onOpenArticle, onSaveArticle }: KnowledgePanelProps) {
  const directory = useMemo(() => buildKnowledgeDirectory(articles), [articles]);
  const articleMap = useMemo(() => new Map(articles.map((article) => [article.id, article])), [articles]);
  const [selectedId, setSelectedId] = useState<string | null>(initialEntityId || null);
  const [type, setType] = useState<EntityType | "all">("all");
  const [query, setQuery] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [input, setInput] = useState<ManualInput>(blankInput);
  const [fieldInputs, setFieldInputs] = useState<Record<string, FieldInput>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  useEffect(() => { setSelectedId(initialEntityId || null); setCopyMessage(""); }, [initialEntityId]);
  const selected = selectedId ? findKnowledgeEntity(directory, selectedId) : null;
  const results = useMemo(() => searchKnowledgeEntities(directory, query, type === "all" ? undefined : type), [directory, query, type]);
  const counts = { drug: directory.drugs.length, target: directory.targets.length, deal: directory.deals.length, company: directory.companies.length };
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const coveredArticles = new Set([...directory.drugs, ...directory.targets, ...directory.companies, ...directory.deals].flatMap((entity) => entity.articles.map((article) => article.id))).size;

  function openForm(entity?: KnowledgeEntity) {
    setInput({ ...blankInput(), ...(entity ? { entityType: entity.type, entityName: entity.name, aliases: entity.aliases.join("、") } : {}) });
    setFieldInputs({}); setFormError(""); setSaveMessage(""); setShowForm(true);
  }
  function updateInput<K extends keyof ManualInput>(key: K, value: ManualInput[K]) {
    setInput((current) => ({ ...current, [key]: value }));
  }
  function updateField(key: string, patch: Partial<FieldInput>) {
    setFieldInputs((current) => ({ ...current, [key]: { ...(current[key] || { status: "not-recorded", value: "" }), ...patch } }));
  }
  async function copyLink(entity: KnowledgeEntity) {
    const link = new URL("/knowledge/" + encodeURIComponent(entity.id), window.location.origin).href;
    try { await navigator.clipboard.writeText(link); setCopyMessage("专题链接已复制。"); }
    catch { setCopyMessage("可使用旁边的“打开专题链接”复制地址。"); }
  }
  async function saveManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setFormError("");
    const originalUrl = validSourceUrl(input.url), publishedAt = input.date ? exactDate(input.date) : null;
    if (!originalUrl) { setFormError("请填写可打开的 HTTP 或 HTTPS 原始来源链接。"); return; }
    if (input.date && !publishedAt) { setFormError("请填写准确的来源发布日期；不确定时留空。"); return; }
    if (![input.title, input.source, input.summary, input.entityName].every((value) => value.trim())) { setFormError("请补全标题、来源、摘要和实体名称。"); return; }
    const aliases = [...new Set(input.aliases.split(/[,，、\n]/u).map((alias) => alias.trim()).filter(Boolean))];
    if (aliases.length > 20 || aliases.some((alias) => alias.length > 180)) { setFormError("最多录入 20 个已核对别名，每个别名不超过 180 字。"); return; }
    const definitions = ENTITY_FIELDS[input.entityType];
    for (const field of definitions) if (fieldInputs[field.key]?.status === "reported" && !fieldInputs[field.key].value.trim()) {
      setFormError(`请填写“${field.label}”的来源记载，或将它改为未收录。`); return;
    }
    const canonical = new URL(originalUrl); canonical.hash = "";
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid"]) canonical.searchParams.delete(key);
    const url = canonical.href;
    const facts: EntityFact[] = definitions.flatMap(({ key, label }) => {
      const field = fieldInputs[key];
      if (!field || field.status === "not-recorded") return [];
      return [{
        key, label, value: field.status === "reported" ? field.value.trim() : null, status: field.status,
        sourceUrl: originalUrl, sourceDate: publishedAt, dateBasis: publishedAt ? "source-publication" : "unknown", provenance: "curated",
      }];
    });
    setSaving(true);
    try {
      const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url)));
      const id = "art-" + [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
      const article: Article & ArticleKnowledge & { sourceText?: string } = {
        id, title: input.title.trim(), category: input.category, publishedAt, url, source: input.source.trim(),
        type: "手工资料", summary: input.summary.trim(), keyPoints: [],
        limitations: "手工整理，尚未核对全文；结构化字段仅代表本次录入的来源记载。", topics: input.entityName.trim().length <= 70 ? [input.entityName.trim()] : [],
        readingBasis: "手工整理，尚未核对全文", group: "专题资料", collectedAt: new Date().toISOString(), coverSource: null,
        ...(input.sourceText.trim() ? { sourceText: input.sourceText.trim() } : {}),
        entities: [{
          type: input.entityType, name: input.entityName.trim(), sourceUrl: originalUrl, provenance: "curated",
          aliases, facts,
        }],
      };
      if(new TextEncoder().encode(JSON.stringify({article})).byteLength>110000) {
        setFormError("本次资料内容较长，请缩短摘录或分次补充，保留关键数字和来源。");return;
      }
      await onSaveArticle(article);
      setShowForm(false); setSelectedId(null); setQuery(""); setType(input.entityType);
      setSaveMessage("资料已收录，专题会累计你填写的有来源记录。");
    } catch (error) { setFormError(error instanceof Error ? error.message : "资料尚未保存，请稍后重试。"); }
    finally { setSaving(false); }
  }

  return <section className="knowledge-panel" aria-label="专题资料库">
    <header className="knowledge-heading">
      <div><p className="knowledge-eyebrow"><BookOpen size={15}/> KNOWLEDGE COLLECTION</p><h1>沿着一条线索，继续读<span>。</span></h1><p className="knowledge-intro">围绕药物、靶点与合作，把分散的信息放回同一张资料卡。</p></div>
      <button className="secondary-btn" onClick={() => openForm(selected || undefined)}><Plus size={16}/>补充资料</button>
    </header>
    <p><a className="secondary-btn" href="/targets">进入靶点研究：功能、疾病关联与药物线索</a></p>
    <p className="knowledge-coverage">仅汇总当前已收录的 {articles.length} 篇材料；其中 {coveredArticles} 篇带有结构化记录，共 {total} 个专题。覆盖范围随资料积累扩展。</p>
    {saveMessage && <p className="knowledge-notice" role="status">{saveMessage}</p>}

    {showForm && <form className="knowledge-form" onSubmit={saveManual} onKeyDownCapture={(event) => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }}>
      <div className="knowledge-form-heading"><div><h2>补充一份有来源的资料</h2><p>填入你已核对的记录。留空表示未收录；只有来源明确说明时，才选择“来源未披露”。</p></div><button type="button" className="quiet-btn" onClick={() => { setShowForm(false); setFormError(""); }} disabled={saving}>收起</button></div>
      <fieldset disabled={saving}><legend>原始材料</legend><div className="knowledge-form-grid">
        <label className="knowledge-form-wide">原始来源链接<input type="url" required maxLength={2500} value={input.url} onChange={(event) => updateInput("url", event.target.value)} placeholder="https://原始公告或论文链接"/></label>
        <label className="knowledge-form-wide">标题<input required maxLength={300} value={input.title} onChange={(event) => updateInput("title", event.target.value)}/></label>
        <label>来源名称<input required maxLength={180} value={input.source} onChange={(event) => updateInput("source", event.target.value)} placeholder="公司公告、期刊或监管机构"/></label>
        <label>来源发布日期<span className="knowledge-input-hint">不确定时留空</span><input type="date" value={input.date} onChange={(event) => updateInput("date", event.target.value)}/></label>
        <label>内容分类<select value={input.category} onChange={(event) => updateInput("category", event.target.value as Category)}>{["产业", "临床", "研究", "工具"].map((category) => <option key={category}>{category}</option>)}</select></label>
        <label className="knowledge-form-wide">内容摘要<textarea required rows={4} maxLength={12000} value={input.summary} onChange={(event) => updateInput("summary", event.target.value)} placeholder="说明这份材料实际报告了什么，并保留人群、时间和证据局限。"/></label>
        <label className="knowledge-form-wide">原始材料摘录<span className="knowledge-input-hint">可选，最多 24,000 字；保留数字上下文和原文限定条件，供后续解读使用</span><textarea rows={5} maxLength={24000} value={input.sourceText} onChange={(event) => updateInput("sourceText", event.target.value)} placeholder="粘贴你有权使用的摘要或原文段落；不会据此自动标为已读全文。"/></label>
      </div></fieldset>
      <fieldset disabled={saving}><legend>结构化记录</legend><div className="knowledge-form-grid">
        <label>实体类型<select value={input.entityType} onChange={(event) => { updateInput("entityType", event.target.value as EntityType); setFieldInputs({}); }}>{typeChoices.map((choice) => <option key={choice} value={choice}>{ENTITY_TYPE_LABELS[choice]}</option>)}</select></label>
        <label>实体名称<input required maxLength={160} value={input.entityName} onChange={(event) => updateInput("entityName", event.target.value)}/></label>
        <label className="knowledge-form-wide">已核对的别名<span className="knowledge-input-hint">用逗号分隔，不确定时留空</span><input maxLength={1000} value={input.aliases} onChange={(event) => updateInput("aliases", event.target.value)}/></label>
      </div><div className="knowledge-input-fields">{ENTITY_FIELDS[input.entityType].map((field) => {
        const value = fieldInputs[field.key] || { status: "not-recorded", value: "" };
        return <div className="knowledge-input-field" key={field.key}>
          <label htmlFor={"knowledge-status-" + field.key}>{field.label}</label>
          <select id={"knowledge-status-" + field.key} value={value.status} onChange={(event) => updateField(field.key, { status: event.target.value as FactStatus })}><option value="not-recorded">未收录</option><option value="reported">填写来源记载</option><option value="not-disclosed">来源明确未披露</option></select>
          {value.status === "reported" && <textarea aria-label={field.label + "的来源记载"} rows={2} maxLength={1800} required value={value.value} onChange={(event) => updateField(field.key, { value: event.target.value })} placeholder="保留适用人群、研究阶段、金额口径等限定条件。"/>}
        </div>;
      })}</div></fieldset>
      <p className="knowledge-form-scope">以上记录均引用所填原始链接及其发布日期，阅读依据标为“手工整理，尚未核对全文”。同一来源链接会更新材料，并累积已有的结构化记录。</p>
      {formError && <p className="knowledge-form-error" role="alert">{formError}</p>}
      <div className="knowledge-form-actions"><button type="button" className="secondary-btn" onClick={() => setShowForm(false)} disabled={saving}>取消</button><button type="submit" className="primary-btn" disabled={saving}>{saving ? <Loader2 size={16} className="spin"/> : <Plus size={16}/>}保存资料</button></div>
    </form>}

    {selected ? <div className="knowledge-detail">
      <button className="knowledge-back" onClick={() => { setSelectedId(null); setCopyMessage(""); }}><ArrowLeft size={16}/>返回专题目录</button>
      <header className="knowledge-detail-heading"><div><span className="knowledge-type-label">{ENTITY_TYPE_LABELS[selected.type]}</span><h2>{selected.name}</h2>{!!selected.aliases.length && <p>已核对别名：{selected.aliases.join(" / ")}</p>}</div><div className="knowledge-share"><a className="secondary-btn" href={"/knowledge/" + encodeURIComponent(selected.id)} target="_blank" rel="noopener noreferrer">打开专题链接 <ExternalLink size={13}/></a><button className="secondary-btn" onClick={() => copyLink(selected)}><Copy size={13}/>复制链接</button></div></header>
      {copyMessage && <p className="knowledge-notice" role="status">{copyMessage}</p>}
      <p className="knowledge-detail-scope">来自 {selected.articles.length} 篇已收录材料、{selected.sourceUrls.length} 个来源链接。字段保留每次来源的记录，不自动将历史阶段或潜在交易金额解释为当前状态或已到账金额。</p>
      <section className="knowledge-section"><div className="knowledge-section-heading"><h3>已有记录与待补字段</h3><span>每条记录保留来源与日期口径</span></div><div className="knowledge-facts-grid">{selected.fields.map((field) => <section className="knowledge-field-card" key={field.key}>
        <div className="knowledge-field-heading"><h4>{field.label}</h4><span className={"knowledge-field-status status-" + field.status}>{fieldStatusText(field.status)}</span></div>
        {field.facts.length ? <ul className="knowledge-evidence-list">{field.facts.map((fact, index) => <EvidenceItem key={fact.articleId + fact.sourceUrl + index} fact={fact}/>)}</ul> : <p className="knowledge-missing">未收录</p>}
      </section>)}</div></section>
      <section className="knowledge-section"><div className="knowledge-section-heading"><h3>资料时间线</h3><span>按文章发表日期；未知日期单独保留</span></div><ol className="knowledge-timeline">{selected.timeline.map((entry) => <li key={entry.articleId}>
        <div className="knowledge-timeline-date">{entry.date ? <time dateTime={entry.date}>{entry.date}</time> : <span>发表日期未收录</span>}</div>
        <div className="knowledge-timeline-content"><span className="knowledge-timeline-source">{entry.source}</span>{articleMap.has(entry.articleId) ? <button className="knowledge-article-link" onClick={() => onOpenArticle(articleMap.get(entry.articleId)!)}>{entry.title}<ChevronRight size={17}/></button> : <h4>{entry.title}</h4>}
          <p className="knowledge-timeline-basis">阅读依据：{entry.readingBasis}</p>
          {!!entry.facts.length && <ul className="knowledge-timeline-facts">{entry.facts.map((fact, index) => <li key={fact.key + index}><span>{fact.label}</span>{fact.status === "reported" ? fact.value : fieldStatusText(fact.status)}</li>)}</ul>}
          <a className="knowledge-source-link" href={entry.url} target="_blank" rel="noopener noreferrer">打开这份原始材料 <ExternalLink size={12}/></a>
        </div>
      </li>)}</ol></section>
    </div> : <>
      {selectedId && <p className="knowledge-notice">当前已收录材料中还没有这个专题。可以返回目录，或补充它的来源资料。</p>}
      <div className="knowledge-toolbar"><div className="knowledge-type-tabs" role="group" aria-label="专题类型"><button className={type === "all" ? "active" : ""} aria-pressed={type === "all"} onClick={() => setType("all")}>全部 <span>{total}</span></button>{typeChoices.map((choice) => <button key={choice} className={type === choice ? "active" : ""} aria-pressed={type === choice} onClick={() => setType(choice)}>{ENTITY_TYPE_LABELS[choice]} <span>{counts[choice]}</span></button>)}</div><label className="knowledge-search"><Search size={17}/><input aria-label="检索专题" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名称、别名或已录入的线索"/></label></div>
      <div className="knowledge-directory">{results.map((entity) => {
        const filled = entity.fields.filter((field) => field.status !== "not-recorded");
        return <button className="knowledge-entity-card" key={entity.id} onClick={() => { setSelectedId(entity.id); setCopyMessage(""); }}>
          <div className="knowledge-card-top"><span className={"knowledge-type-label type-" + entity.type}>{ENTITY_TYPE_LABELS[entity.type]}</span><span>{entity.articles.length} 篇关联材料</span></div><h2>{entity.name}</h2>{!!entity.aliases.length && <p className="knowledge-card-aliases">{entity.aliases.slice(0, 3).join(" / ")}</p>}
          <dl>{filled.slice(0, 2).map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{field.value || fieldStatusText(field.status)}</dd></div>)}</dl><div className="knowledge-card-bottom"><span>{filled.length} / {entity.fields.length} 项字段已有来源记录</span><span>查看资料 <ChevronRight size={14}/></span></div>
        </button>;
      })}</div>
      {!results.length && <div className="knowledge-empty"><BookOpen size={30}/><h2>{query.trim() ? "暂未找到匹配专题" : "从一份有来源的资料开始"}</h2><p>{query.trim() ? "试试其他名称或已核对的别名。" : "结构化录入药物、靶点或合作记录后，关联材料与时间线会在这里逐步积累。"}</p><button className="primary-btn" onClick={() => openForm()}><Plus size={15}/>补充资料</button></div>}
      {!!directory.topicSuggestions.length && <details className="knowledge-suggestions"><summary>文章中的主题线索 <span>{directory.topicSuggestions.length}</span></summary><p>这些线索来自文章标签，尚未确认为实体或核对实体事实。</p><div>{directory.topicSuggestions.map((topic) => <span key={topic.name}>{topic.name}<small>{topic.articleCount} 篇</small></span>)}</div></details>}
    </>}
  </section>;
}
