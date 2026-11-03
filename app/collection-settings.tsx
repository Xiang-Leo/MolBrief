"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCheck, Clock3, ExternalLink, Loader2, Pause, Play, RefreshCw, Search, ShieldCheck } from "lucide-react";
import "./collection.css";

type CollectionSettings = {
  enabled: boolean;
  hour: number;
  pubmed: boolean;
  web: boolean;
  summarize: boolean;
  maxQueriesPerRun: number;
  maxNewPerRun: number;
  maxWebQueriesPerDay: number;
  maxSummariesPerDay: number;
};
type CollectionRunStatus = "running" | "success" | "partial" | "failed" | "interrupted" | "skipped";
type CollectionRun = {
  id: string;
  trigger: "manual" | "scheduled" | "retry";
  status: CollectionRunStatus;
  startedAt: string;
  finishedAt: string | null;
  queries: number;
  found: number;
  added: number;
  duplicates: number;
  summarized: number;
  errors: string[];
  mode?: "collect" | "summarize";
  stage?: string; currentLabel?: string; processed?: number; summaryAttempts?: number;
};
type CollectionState = {
  settings: CollectionSettings;
  nextRunAt: string | null;
  worker: { lastSeenAt: string | null; healthy: boolean };
  running: boolean;
  queued: boolean;
  today: { webQueries: number; summaries: number };
  capabilities: { parallel: boolean; llm: boolean };
  runs: CollectionRun[];
  pendingSummaries?: number;
};
type LimitKey = "maxQueriesPerRun" | "maxNewPerRun" | "maxWebQueriesPerDay" | "maxSummariesPerDay";
type CollectionDraft = Omit<CollectionSettings, LimitKey> & Record<LimitKey, string>;

const limits: { key: LimitKey; label: string; min: number; max: number; hint: string }[] = [
  { key: "maxQueriesPerRun", label: "每次检索上限", min: 1, max: 20, hint: "单次采集最多执行的查询数。" },
  { key: "maxNewPerRun", label: "每次新增上限", min: 1, max: 30, hint: "单次最多收录多少篇新材料。" },
  { key: "maxWebQueriesPerDay", label: "每日全网查询上限", min: 0, max: 40, hint: "Parallel 调用上限；设为 0 将不发起调用。" },
  { key: "maxSummariesPerDay", label: "每日中文解读上限", min: 0, max: 30, hint: "模型解读调用上限；设为 0 将不发起调用。" },
];
const statuses: Record<CollectionRunStatus, string> = {
  running: "进行中", success: "已完成", partial: "部分完成", failed: "未完成", interrupted: "已中断", skipped: "已跳过",
};
const terminal = (status: CollectionRunStatus) => status !== "running";
const phaseNames:Record<string,string>={loading:"正在读取资料",searching:"正在检索",summarizing:"正在生成中文解读",saving:"正在保存",finished:"正在结束"};
const count = (value: number) => Number.isFinite(value) ? value.toLocaleString("zh-CN") : "—";

function formatTime(value: string | null, empty = "暂无记录") {
  if (!value) return empty;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "时间待确认";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(parsed);
}
function asDraft(settings: CollectionSettings): CollectionDraft {
  return {
    ...settings,
    maxQueriesPerRun: String(settings.maxQueriesPerRun), maxNewPerRun: String(settings.maxNewPerRun),
    maxWebQueriesPerDay: String(settings.maxWebQueriesPerDay), maxSummariesPerDay: String(settings.maxSummariesPerDay),
  };
}
function equalDraft(left: CollectionDraft, right: CollectionDraft) {
  return (Object.keys(left) as (keyof CollectionDraft)[]).every(key => left[key] === right[key]);
}
function isState(value: unknown): value is CollectionState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<CollectionState>;
  return !!state.settings && !!state.worker && !!state.today && !!state.capabilities && Array.isArray(state.runs);
}
async function readResponse(response: Response) {
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "采集设置暂时无法读取，请稍后重试。";
    throw new Error(message);
  }
  if (!isState(data)) throw new Error("采集状态暂时无法读取，请稍后重试。");
  return data;
}

export default function CollectionSettingsPanel({ onUpdated }: { onUpdated?: () => void }) {
  const [state, setState] = useState<CollectionState | null>(null);
  const [draft, setDraft] = useState<CollectionDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "run" | null>(null);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [batchLimit,setBatchLimit]=useState(3);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<LimitKey, string>>>({});
  const [pageVisible, setPageVisible] = useState(true);
  const [inView, setInView] = useState(true);
  const sectionRef = useRef<HTMLElement | null>(null);
  const stateRef = useRef<CollectionState | null>(null);
  const mounted = useRef(false);
  const fetching = useRef(false);
  const busyRef = useRef<"save" | "run" | null>(null);
  const requestVersion = useRef(0);
  const controllers = useRef(new Set<AbortController>());
  const updatedRef = useRef(onUpdated);
  const seenRuns = useRef<Map<string, CollectionRunStatus> | null>(null);

  useEffect(() => { updatedRef.current = onUpdated; }, [onUpdated]);

  const applyState = useCallback((next: CollectionState, resetDraft = false) => {
    const previous = stateRef.current;
    const priorRuns = seenRuns.current;
    const completed = priorRuns && next.runs.some(run => terminal(run.status) && priorRuns.get(run.id) !== run.status);
    seenRuns.current = new Map(next.runs.map(run => [run.id, run.status]));
    stateRef.current = next;
    setState(next);
    setDraft(current => resetDraft || !current || (previous && equalDraft(current, asDraft(previous.settings))) ? asDraft(next.settings) : current);
    if (completed) updatedRef.current?.();
  }, []);

  const refresh = useCallback(async (quiet = false) => {
    if (fetching.current || busyRef.current) return;
    fetching.current = true;
    const version = ++requestVersion.current;
    const controller = new AbortController();
    controllers.current.add(controller);
    if (!quiet) setLoading(true);
    try {
      const response = await fetch("/api/collection", { cache: "no-store", signal: controller.signal });
      const next = await readResponse(response);
      if (mounted.current && version === requestVersion.current) {
        applyState(next);
        setLoadError("");
      }
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted && version === requestVersion.current)
        setLoadError(failure instanceof Error ? failure.message : "采集状态更新未完成，请重试。");
    } finally {
      fetching.current = false;
      controllers.current.delete(controller);
      if (mounted.current) setLoading(false);
    }
  }, [applyState]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const visibilityChanged = () => setPageVisible(document.visibilityState !== "hidden");
    visibilityChanged();
    document.addEventListener("visibilitychange", visibilityChanged);
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
      setInView(entries.some(entry => entry.isIntersecting));
    }, { rootMargin: "120px" });
    if (sectionRef.current) observer?.observe(sectionRef.current);
    return () => {
      mounted.current = false;
      controllers.current.forEach(controller => controller.abort());
      observer?.disconnect();
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [refresh]);

  useEffect(() => {
    if (!pageVisible || !inView) return;
    const timer = setInterval(() => { void refresh(true); }, state?.running || state?.queued ? 5000 : 15000);
    return () => clearInterval(timer);
  }, [refresh, pageVisible, inView, state?.running, state?.queued]);

  function change<K extends keyof CollectionDraft>(key: K, value: CollectionDraft[K]) {
    setDraft(current => current ? { ...current, [key]: value } : current);
    setError(""); setMessage("");
    if (limits.some(limit => limit.key === key)) setFieldErrors(current => ({ ...current, [key]: undefined }));
  }

  async function submit(action: "save" | "run", mode:"collect"|"summarize"="collect") {
    if (!state || !draft || busyRef.current || (action === "run" && (state.running || state.queued))) return;
    let settings: CollectionSettings | undefined;
    if (action === "save") {
      const errors: Partial<Record<LimitKey, string>> = {};
      for (const limit of limits) {
        const raw = draft[limit.key].trim(), value = Number(raw);
        if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < limit.min || value > limit.max)
          errors[limit.key] = `请输入 ${limit.min}–${limit.max} 之间的整数。`;
      }
      setFieldErrors(errors);
      if (Object.keys(errors).length) { setError("请检查下方标出的采集上限。"); setMessage(""); return; }
      settings = {
        ...draft,
        maxQueriesPerRun: Number(draft.maxQueriesPerRun), maxNewPerRun: Number(draft.maxNewPerRun),
        maxWebQueriesPerDay: Number(draft.maxWebQueriesPerDay), maxSummariesPerDay: Number(draft.maxSummariesPerDay),
      };
    }
    busyRef.current = action;
    setBusy(action); setError(""); setMessage("");
    const version = ++requestVersion.current;
    const controller = new AbortController();
    controllers.current.add(controller);
    try {
      const response = await fetch("/api/collection", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify(action === "save" ? { action, settings } : { action,mode,...(mode==="summarize"?{limit:batchLimit}:{}) }),
      });
      const next = await readResponse(response);
      if (mounted.current && version === requestVersion.current) {
        applyState(next, action === "save");
        setLoadError("");
        setMessage(action === "save" ? "采集设置已保存。" : next.worker.healthy ? (mode==="summarize"?"中文补全已排队，将处理已收录但尚无扩展解读的文章，并遵守今日调用上限。":"新资料采集已排队，将在一分钟内开始；进度和结果会显示在下方。") : "任务已排队，采集服务恢复后将继续处理。已有内容仍可阅读。");
      }
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : "这次采集操作未完成，请重试。");
    } finally {
      controllers.current.delete(controller);
      busyRef.current = null;
      if (mounted.current) { setBusy(null); void refresh(true); }
    }
  }

  const dirty = !!(state && draft && !equalDraft(draft, asDraft(state.settings)));
  const runs = useMemo(() => (state?.runs || []).slice(0, 10), [state?.runs]);
  const lastCompleted = runs.find(run => !!run.finishedAt);
  const active = !!(state?.running || state?.queued);

  return <section className="settings-panel collection-settings" id="collection-settings" ref={sectionRef} aria-labelledby="collection-heading">
    <div className="collection-heading">
      <div className="panel-title"><Clock3 size={19}/><h2 id="collection-heading">自动收集</h2></div>
      {state && <span className={"collection-state " + (state.running ? "running" : state.queued ? "queued" : state.settings.enabled ? "enabled" : "paused")}>
        {state.running ? <Loader2 size={13} className="spin"/> : state.queued ? <Clock3 size={13}/> : state.settings.enabled ? <Check size={13}/> : <Pause size={13}/>}
        {state.running ? "采集中" : state.queued ? "已排队" : state.settings.enabled ? "定时已开启" : "定时已暂停"}
      </span>}
    </div>
    <p className="settings-intro collection-intro">按你的关注主题收集新材料，收录到今日精选。收藏仍由你决定。</p>
    {loading && !state && <p className="collection-loading" role="status"><Loader2 size={17} className="spin"/>正在读取采集设置…</p>}
    {loadError && <div className="collection-load-error" role="alert"><p>{loadError}</p><button type="button" className="quiet-btn" disabled={loading || !!busy} onClick={() => refresh()}><RefreshCw size={14}/>重新读取</button></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p className="form-success" role="status"><Check size={16}/>{message}</p>}
    {state && draft && <>
      <dl className="collection-overview">
        <div><dt>下次定时采集</dt><dd>{state.settings.enabled ? formatTime(state.nextRunAt, "等待安排") : "已暂停"}</dd><small>北京时间</small></div>
        <div><dt>上次完成</dt><dd>{formatTime(lastCompleted?.finishedAt || null)}</dd><small>{lastCompleted ? statuses[lastCompleted.status] : "完成后可在下方查看结果"}</small></div>
      </dl>
      {!state.worker.healthy && <p className="collection-warning" role="status"><Clock3 size={16}/><span>采集暂未就绪，排队任务会在恢复后处理。{state.worker.lastSeenAt ? `最近在线：${formatTime(state.worker.lastSeenAt)}（北京时间）。` : "尚无在线记录。"}</span></p>}
      <form className="collection-form" noValidate onSubmit={event => { event.preventDefault(); void submit("save"); }}>
        <div className="collection-schedule">
          <label className="collection-toggle" htmlFor="collection-enabled"><span><strong>每日自动收集</strong><small>关闭后暂停后续定时，已开始的采集仍会完成；也可手动采集。</small></span><input id="collection-enabled" type="checkbox" role="switch" aria-label="每日自动收集" checked={draft.enabled} disabled={!!busy} onChange={event => change("enabled", event.target.checked)}/></label>
          <div className="collection-hour"><label htmlFor="collection-hour">每日采集时间</label><div><select id="collection-hour" value={draft.hour} disabled={!!busy} onChange={event => change("hour", Number(event.target.value))}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}</select><span>北京时间 · Asia/Shanghai</span></div></div>
        </div>
        <fieldset className="collection-sources" disabled={!!busy}>
          <legend>采集来源与整理方式</legend>
          <label className="collection-option" htmlFor="collection-pubmed"><input id="collection-pubmed" type="checkbox" checked={draft.pubmed} onChange={event => change("pubmed", event.target.checked)}/><span><strong>公开论文</strong><small>检索论文题录与摘要，无需配置密钥。</small></span><span className="collection-cost free">无需付费 API</span></label>
          <div className="collection-provider">
            <label className="collection-option" htmlFor="collection-web"><input id="collection-web" type="checkbox" checked={draft.web} disabled={!state.capabilities.parallel && !draft.web} onChange={event => change("web", event.target.checked)}/><span><strong>Parallel 全网检索</strong><small>补充公司公告、药物进展和公开网页。</small></span><span className="collection-cost">按服务商计费</span></label>
            {!state.capabilities.parallel && <p className="collection-provider-note">尚未配置全网搜索。<a href="/settings#service-settings">去配置 Parallel <ExternalLink size={12}/></a>{draft.web && "当前已勾选，但配置完成前无法调用。"}</p>}
          </div>
          <div className="collection-provider">
            <label className="collection-option" htmlFor="collection-summarize"><input id="collection-summarize" type="checkbox" checked={draft.summarize} disabled={!state.capabilities.llm && !draft.summarize} onChange={event => change("summarize", event.target.checked)}/><span><strong>自动生成中文解读</strong><small>使用已配置的模型整理新材料。</small></span><span className="collection-cost">按服务商计费</span></label>
            {!state.capabilities.llm && <p className="collection-provider-note">尚未配置中文模型，新材料将保留原始摘要。<a href="/settings#service-settings">去配置模型 <ExternalLink size={12}/></a></p>}
          </div>
        </fieldset>
        {!draft.pubmed && !draft.web && <p className="collection-warning" role="status">尚未选择检索来源，请选择公开论文或全网检索，才能获得新材料。</p>}
        <fieldset className="collection-limits" disabled={!!busy}>
          <legend>收录与调用上限</legend>
          <div className="collection-limit-grid">{limits.map(limit => <div className="collection-limit" key={limit.key}>
            <label htmlFor={"collection-" + limit.key}>{limit.label}<span>{limit.min}–{limit.max}</span></label>
            <input id={"collection-" + limit.key} name={limit.key} type="number" inputMode="numeric" min={limit.min} max={limit.max} step={1} value={draft[limit.key]} aria-invalid={!!fieldErrors[limit.key]} aria-describedby={"collection-" + limit.key + "-hint" + (fieldErrors[limit.key] ? " collection-" + limit.key + "-error" : "")} onChange={event => change(limit.key, event.target.value)}/>
            <small id={"collection-" + limit.key + "-hint"}>{limit.hint}</small>
            {fieldErrors[limit.key] && <p id={"collection-" + limit.key + "-error"} className="collection-field-error">{fieldErrors[limit.key]}</p>}
          </div>)}</div>
        </fieldset>
        <div className="collection-usage"><span>今日调用尝试（失败也计入）</span><span>全网查询 <strong>{count(state.today.webQueries)}</strong> / {state.settings.maxWebQueriesPerDay}</span><span>中文模型 <strong>{count(state.today.summaries)}</strong> / {state.settings.maxSummariesPerDay}</span></div>
        <div className="collection-actions"><button type="submit" className="primary-btn" disabled={!!busy || !dirty}>{busy === "save" ? <Loader2 size={16} className="spin"/> : <Check size={16}/>}保存采集设置</button><button type="button" className="secondary-btn" disabled={!!busy || dirty || active} onClick={() => submit("run")}>{busy === "run" || state.running ? <Loader2 size={16} className="spin"/> : state.queued ? <Clock3 size={16}/> : <Play size={15}/>} {state.running ? "任务运行中" : state.queued ? "任务已排队" : busy === "run" ? "正在排队" : "立即采集新资料"}</button><button type="button" className="secondary-btn" disabled={!!busy||dirty||active||!state.capabilities.llm||!state.pendingSummaries||state.today.summaries>=state.settings.maxSummariesPerDay} onClick={()=>submit("run","summarize")}>补全已收录中文解读</button></div>
        <label className="collection-batch-limit">本次补全上限 <select aria-label="本次补全上限" value={batchLimit} onChange={e=>setBatchLimit(Number(e.target.value))}>{[1,3,6,12].map(n=><option key={n} value={n}>{n} 篇</option>)}</select></label>
        <p className="field-note">待补全扩展解读：{state.pendingSummaries??0} 篇。采集新资料与补全旧文章分别执行；补全同时受本次篇数、每轮处理上限和每日模型次数限制。</p>
        {state.today.summaries>=state.settings.maxSummariesPerDay&&<p className="form-error" role="status">今日模型调用上限已用完。北京时间次日 00:00 恢复；也可自行修改并保存上限。已有英文摘要仍可阅读。</p>}
        {dirty && <p className="field-note">有尚未保存的修改。先保存，再按新设置立即采集。</p>}
      </form>
      <p className="collection-scope"><ShieldCheck size={15}/><span>新材料只加入今日精选，不会自动收藏。未启用或未配置模型时保留原始摘要。当前按来源 URL 去重，同一事件的不同报道仍可能分别收录。</span></p>
      <section className="collection-history" aria-labelledby="collection-history-heading">
        <div className="collection-history-heading"><h3 id="collection-history-heading">最近采集</h3><button type="button" className="quiet-btn" disabled={loading || !!busy} onClick={() => refresh()}><RefreshCw size={14} className={loading ? "spin" : ""}/>刷新状态</button></div>
        <p className="collection-live-status" aria-live="polite">{state.running ? "正在查找和整理材料，完成后会自动更新结果。" : state.queued ? "任务已排队，开始后会在这里显示进度。" : state.worker.healthy ? "采集服务正常，时间均为北京时间。" : "采集服务暂未就绪，时间均为北京时间。"}</p>
        {!runs.length ? <div className="collection-empty"><Search size={22}/><p>还没有采集记录。你可以先保存设置，再手动采集一次。</p></div> : <ol className="collection-run-list">{runs.map(run => <li className={"collection-run run-" + run.status} key={run.id}>
          <div className="collection-run-heading"><div><strong>{run.mode==="summarize"?"补全中文解读":run.trigger === "scheduled" ? "定时采集" : run.trigger === "retry" ? "重试采集" : "手动采集"}</strong><time dateTime={run.startedAt}>{formatTime(run.startedAt)}</time></div><span className={"collection-run-status status-" + run.status}>{run.status === "running" ? <Loader2 size={12} className="spin"/> : run.status === "success" ? <CheckCheck size={13}/> : null}{statuses[run.status]}</span></div>
          {run.status==="running"&&<p className="collection-live-status" role="status">{phaseNames[run.stage||"loading"]||"正在处理"}：{run.currentLabel||"准备中"} · 已处理 {run.processed??0} 篇</p>}
          <dl className="collection-run-counts"><div><dt>新增</dt><dd>{count(run.added)}<small>篇</small></dd></div><div><dt>重复来源</dt><dd>{count(run.duplicates)}</dd></div><div><dt>找到</dt><dd>{count(run.found)}</dd></div><div><dt>检索</dt><dd>{count(run.queries)}</dd></div><div><dt>中文解读</dt><dd>{count(run.summarized)}</dd></div></dl>
          {run.finishedAt && <p className="collection-run-finished">完成于 {formatTime(run.finishedAt)}</p>}
          <p className="collection-run-finished">模型尝试：{run.stage==="pending"?"历史未记录":run.summaryAttempts??0} 次；成功保存中文解读：{run.summarized} 篇。</p>
          {!!run.errors.length && <details className="collection-run-errors" open={run.status==="failed"||run.status==="partial"||run.status==="skipped"}><summary>{run.errors.length} 条提示</summary><ul>{run.errors.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
        </li>)}</ol>}
      </section>
    </>}
  </section>;
}
