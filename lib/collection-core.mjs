import { createHash, randomUUID } from 'node:crypto';

const MINUTE = 60000, HOUR = 60 * MINUTE, DAY = 24 * HOUR, BEIJING_OFFSET = 8 * HOUR;
export const COLLECTION_RUN_TIMEOUT_MS = 9 * MINUTE;
export const COLLECTION_LEASE_MS = 15 * MINUTE;
const CALL_TIMEOUT_MS = 75000, PER_QUERY_ADD_CAP = 2;
export const DEFAULT_COLLECTION_SETTINGS = Object.freeze({
  enabled: true, pubmed: true, web: false, summarize: false, hour: 8,
  maxQueriesPerRun: 8, maxNewPerRun: 12, maxWebQueriesPerDay: 6, maxSummariesPerDay: 6,
});
const LIMITS = { hour: [0, 23], maxQueriesPerRun: [1, 20], maxNewPerRun: [1, 30], maxWebQueriesPerDay: [0, 40], maxSummariesPerDay: [0, 30] };
const BOOLEAN_FIELDS = ['enabled', 'pubmed', 'web', 'summarize'];
const iso = (time) => new Date(time).toISOString();
export const beijingDay = (time) => iso(time + BEIJING_OFFSET).slice(0, 10);
export function nextCollectionRunAt(time, hour = 8) {
  const local = new Date(time + BEIJING_OFFSET);
  let scheduled = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour) - BEIJING_OFFSET;
  if (scheduled <= time) scheduled += DAY;
  return iso(scheduled);
}

export class CollectionError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'CollectionError'; this.status = status; }
}
function internalError(code) {
  const error = new CollectionError('采集任务未完成。', 503); error.collectionCode = code; return error;
}
function validateSettings(partial, existing) {
  if (!partial || typeof partial !== 'object' || Array.isArray(partial) || Object.keys(partial).some((key) => !Object.hasOwn(DEFAULT_COLLECTION_SETTINGS, key)))
    throw new CollectionError('采集配置包含不支持的项目。');
  for (const [key, value] of Object.entries(partial)) {
    if (BOOLEAN_FIELDS.includes(key) ? typeof value !== 'boolean' : !Number.isSafeInteger(value) || value < LIMITS[key][0] || value > LIMITS[key][1])
      throw new CollectionError('采集配置超出允许范围，请检查时间、数量与每日预算。');
  }
  return { ...existing, ...partial };
}
const fingerprint = (source, query) => createHash('sha256').update(JSON.stringify([source, query.trim().replace(/\s+/g, ' ')])).digest('hex');
function errorInfo(error, now) {
  const status = Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599 ? error.status : null;
  let retry = error?.retryAfter;
  if (retry == null && typeof error?.headers?.get === 'function') retry = error.headers.get('retry-after');
  let retryAt = null;
  if (typeof retry === 'number' && Number.isFinite(retry) && retry > 0) retryAt = now + Math.min(retry, 31536000) * 1000;
  else if (typeof retry === 'string' && /^\d+$/.test(retry)) retryAt = now + Math.min(Number(retry), 31536000) * 1000;
  else if (typeof retry === 'string' && Number.isFinite(Date.parse(retry))) retryAt = Math.max(now + MINUTE, Date.parse(retry));
  if (status === 429 && !retryAt) retryAt = now + HOUR;
  return { status, retryAt, code: ['timeout', 'deadline', 'lease-lost', 'invalid-result'].includes(error?.collectionCode) ? error.collectionCode : 'external' };
}
function safeFailure(source, info, cached = false) {
  const label = { pubmed: '论文检索', web: '全网检索', llm: '中文解读', storage: '资料读写' }[source] || '采集';
  const prefix = cached ? '复用失败缓存：' : '';
  if (info.code === 'deadline' || info.code === 'timeout') return prefix + label + '达到时间上限；已保留本轮成功收录的资料。';
  if (info.status === 429 || info.retryAt) return prefix + label + '要求暂缓请求，已遵守上游退避时间。';
  if ([401, 403].includes(info.status)) return prefix + label + '未获授权，请检查服务配置与权限。';
  if (info.status === 400) return prefix + label + '未接受当前查询或参数，请检查检索式。';
  return prefix + label + '暂未完成' + (info.status ? `（HTTP ${info.status}）` : '') + '；请稍后查看或重试。';
}

export class CollectionStore {
  constructor({ database, now = Date.now }) {
    this.database = database; this.now = now;
    this.database.prepare("INSERT OR IGNORE INTO collection_state(owner_id,settings_json,next_run_at) VALUES('owner',?,?)")
      .bind(JSON.stringify(DEFAULT_COLLECTION_SETTINGS), nextCollectionRunAt(this.now())).run();
  }
  row() { return this.database.prepare("SELECT * FROM collection_state WHERE owner_id='owner'").first(); }
  settings(row = this.row()) {
    try { return validateSettings(JSON.parse(row.settings_json), DEFAULT_COLLECTION_SETTINGS); }
    catch { throw new CollectionError('已保存的采集配置需要检查，请重新保存设置。', 503); }
  }
  status() {
    const now = this.now(), row = this.row(), settings = this.settings(row);
    const running = !!(row.active_run_id && row.lease_token && row.lease_expires_at > iso(now));
    const usage = this.database.prepare('SELECT web_queries,summaries FROM collection_usage WHERE day=?').bind(beijingDay(now)).first();
    const runs = this.database.prepare('SELECT * FROM collection_runs ORDER BY started_at DESC,rowid DESC LIMIT 20').all().results.map((run) => ({
      id: run.id, trigger: run.trigger, status: run.status, startedAt: run.started_at, finishedAt: run.finished_at,
      queries: run.queries, found: run.found, added: run.added, duplicates: run.duplicates, summarized: run.summarized,
      errors: JSON.parse(run.errors_json),
    }));
    const nextRunAt = row.retry_at && row.retry_at < row.next_run_at ? row.retry_at : row.next_run_at;
    return { settings, nextRunAt: settings.enabled ? nextRunAt : null,
      worker: { lastSeenAt: row.last_seen_at, healthy: running || !!(row.last_seen_at && now - Date.parse(row.last_seen_at) < 3 * MINUTE) },
      running, queued: !!row.queued, today: { webQueries: usage?.web_queries || 0, summaries: usage?.summaries || 0 }, runs };
  }
  save(partial) {
    const row = this.row(), before = this.settings(row), settings = validateSettings(partial, before);
    const reschedule = before.hour !== settings.hour || (!before.enabled && settings.enabled);
    this.database.prepare("UPDATE collection_state SET settings_json=?,next_run_at=? WHERE owner_id='owner'")
      .bind(JSON.stringify(settings), reschedule ? nextCollectionRunAt(this.now(), settings.hour) : row.next_run_at).run();
    return this.status();
  }
  enqueue() {
    const row = this.row();
    if (row.active_run_id && row.lease_token && row.lease_expires_at > iso(this.now())) return this.status();
    this.database.prepare("UPDATE collection_state SET queued=1,queued_at=COALESCE(queued_at,?) WHERE owner_id='owner'").bind(iso(this.now())).run();
    return this.status();
  }
  due(row, settings) {
    return !!row.queued || (settings.enabled && (row.next_run_at <= iso(this.now()) || (row.retry_at && row.retry_at <= iso(this.now()))));
  }
  checkpoint(token, deadline = Infinity) {
    if (this.now() >= deadline) throw internalError('deadline');
    const now = iso(this.now());
    const result = this.database.prepare("UPDATE collection_state SET lease_expires_at=?,last_seen_at=? WHERE owner_id='owner' AND lease_token=? AND lease_expires_at>?")
      .bind(iso(this.now() + COLLECTION_LEASE_MS), now, token, now).run();
    if (!result.meta.changes) throw internalError('lease-lost');
  }
  async call(token, deadline, operation) {
    this.checkpoint(token, deadline);
    const controller = new AbortController();
    let timer;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => operation(controller.signal)),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(internalError('timeout')); }, Math.min(CALL_TIMEOUT_MS, deadline - this.now())); }),
      ]);
      this.checkpoint(token, deadline); return result;
    } finally { clearTimeout(timer); }
  }
  progress(run, token) {
    this.database.prepare("UPDATE collection_runs SET queries=?,found=?,added=?,duplicates=?,summarized=?,errors_json=? WHERE id=? AND status='running' AND EXISTS(SELECT 1 FROM collection_state WHERE owner_id='owner' AND lease_token=?)")
      .bind(run.queries, run.found, run.added, run.duplicates, run.summarized, JSON.stringify(run.errors), run.id, token).run();
  }
  warning(run, message) { if (!run.errors.includes(message) && run.errors.length < 40) run.errors.push(message); }
  reserve(source, token, deadline) {
    this.checkpoint(token, deadline);
    const day = beijingDay(this.now()), settings = this.settings();
    const column = source === 'web' ? 'web_queries' : 'summaries';
    const limit = source === 'web' ? settings.maxWebQueriesPerDay : settings.maxSummariesPerDay;
    this.database.prepare('INSERT OR IGNORE INTO collection_usage(day) VALUES(?)').bind(day).run();
    return !!this.database.prepare(`UPDATE collection_usage SET ${column}=${column}+1 WHERE day=? AND ${column}<?`).bind(day, limit).run().meta.changes;
  }
  backoff(source) {
    const row = this.database.prepare('SELECT retry_at FROM collection_backoff WHERE source=?').bind(source).first();
    return row?.retry_at && row.retry_at > iso(this.now()) ? Date.parse(row.retry_at) : null;
  }
  rememberBackoff(source, retryAt) {
    if (!retryAt) return;
    this.database.prepare('INSERT INTO collection_backoff(source,retry_at) VALUES(?,?) ON CONFLICT(source) DO UPDATE SET retry_at=MAX(retry_at,excluded.retry_at)')
      .bind(source, iso(retryAt)).run();
  }
  plan(settings, capabilities, row, trigger, run) {
    const topics = this.database.prepare("SELECT id,name,query FROM topics WHERE user_id='owner' AND (expires_at IS NULL OR julianday(expires_at)>julianday(?)) ORDER BY created_at,id")
      .bind(iso(this.now())).all().results;
    const available = [];
    if (settings.web && !capabilities.parallel) this.warning(run, '全网检索尚未配置，已跳过；可继续收录原始论文摘要。');
    if (settings.summarize && !capabilities.llm) this.warning(run, '摘要模型尚未配置，已保留原始题录与摘要。');
    const unique = new Set();
    for (const topic of topics) for (const source of ['pubmed', 'web']) {
      if (source === 'pubmed' ? !settings.pubmed : !settings.web || !capabilities.parallel) continue;
      const query = String(source === 'pubmed' ? topic.query || topic.name : topic.name).trim().slice(0, 500);
      if (!query) continue;
      const key = fingerprint(source, query);
      if (!unique.has(key)) { unique.add(key); available.push({ source, query, key }); }
    }
    if (!topics.length) this.warning(run, '尚无有效关注主题，本轮未执行检索。');
    else if (!available.length && !run.errors.length) this.warning(run, '尚未启用可用的采集来源，本轮未执行检索。');
    if (trigger === 'retry' && row.retry_of) {
      const prior = this.database.prepare('SELECT plan_json FROM collection_runs WHERE id=?').bind(row.retry_of).first();
      const previous = prior ? JSON.parse(prior.plan_json) : [];
      return previous.filter((task) => unique.has(task.key)).slice(0, settings.maxQueriesPerRun);
    }
    const start = available.length ? row.topic_cursor % available.length : 0;
    const selected = Array.from({ length: Math.min(settings.maxQueriesPerRun, available.length) }, (_, index) => available[(start + index) % available.length]);
    run.rotation = { start, total: available.length };
    return selected;
  }
  recover(row, token) {
    if (!row.active_run_id) return;
    const previous = this.database.prepare('SELECT * FROM collection_runs WHERE id=?').bind(row.active_run_id).first();
    if (!previous || previous.status !== 'running') return;
    const errors = JSON.parse(previous.errors_json);
    errors.push('上一次采集租约已过期，任务按中断处理；已有资料保持不变。');
    this.database.batch([
      this.database.prepare("UPDATE collection_runs SET status='interrupted',finished_at=?,errors_json=? WHERE id=? AND status='running'")
        .bind(iso(this.now()), JSON.stringify(errors.slice(0, 40)), previous.id),
      this.database.prepare("UPDATE collection_state SET active_run_id=NULL,retry_at=?,retry_of=? WHERE owner_id='owner' AND lease_token=?")
        .bind(previous.trigger !== 'retry' ? iso(this.now() + 15 * MINUTE) : null, previous.trigger !== 'retry' ? previous.id : null, token),
    ]);
  }
  async query(task, adapters, run, token, deadline) {
    this.checkpoint(token, deadline);
    const cached = this.database.prepare('SELECT payload_json,expires_at FROM collection_cache WHERE fingerprint=?').bind(task.key).first();
    if (cached && cached.expires_at > iso(this.now())) {
      const result = JSON.parse(cached.payload_json);
      if (result.error) { this.warning(run, safeFailure(task.source, result.error, true)); run.failures++; run.retryAt = Math.max(run.retryAt, Date.parse(cached.expires_at)); return []; }
      run.successfulQueries++; return result.articles;
    }
    const pause = this.backoff(task.source);
    if (pause) { this.warning(run, safeFailure(task.source, { retryAt: pause })); run.failures++; run.retryAt = Math.max(run.retryAt, pause); return []; }
    if (task.source === 'web' && !this.reserve('web', token, deadline)) { this.warning(run, '今日全网检索预算已用完，已跳过付费请求。'); return []; }
    run.queries++; this.progress(run, token);
    let payload, expiresAt;
    try {
      const articles = await this.call(token, deadline, (signal) => adapters.search(task.query, task.source, { signal }));
      if (!Array.isArray(articles)) throw internalError('invalid-result');
      payload = { articles: articles.slice(0, 30) }; run.successfulQueries++;
      expiresAt = this.now() + HOUR;
    } catch (error) {
      if (error?.collectionCode === 'lease-lost' || error?.collectionCode === 'deadline') throw error;
      const info = errorInfo(error, this.now());
      payload = { error: info }; expiresAt = Math.max(this.now() + HOUR, info.retryAt || 0);
      this.rememberBackoff(task.source, info.retryAt); run.failures++; run.retryAt = Math.max(run.retryAt, expiresAt);
      this.warning(run, safeFailure(task.source, info));
    }
    this.checkpoint(token, deadline);
    this.database.prepare('INSERT INTO collection_cache(fingerprint,source,query,payload_json,expires_at) VALUES(?,?,?,?,?) ON CONFLICT(fingerprint) DO UPDATE SET payload_json=excluded.payload_json,expires_at=excluded.expires_at')
      .bind(task.key, task.source, task.query, JSON.stringify(payload), iso(expiresAt)).run();
    return payload.articles || [];
  }
  async tick(adapters) {
    this.database.prepare("UPDATE collection_state SET last_seen_at=? WHERE owner_id='owner'").bind(iso(this.now())).run();
    let row = this.row(), settings = this.settings(row);
    if (row.lease_token && row.lease_expires_at > iso(this.now())) return { ...this.status(), skipped: 'running' };
    if (!this.due(row, settings) && !row.active_run_id) return { ...this.status(), skipped: 'not-due' };
    const token = randomUUID();
    const acquired = this.database.prepare("UPDATE collection_state SET lease_token=?,lease_expires_at=? WHERE owner_id='owner' AND (lease_token IS NULL OR lease_expires_at<=?)")
      .bind(token, iso(this.now() + COLLECTION_LEASE_MS), iso(this.now())).run();
    if (!acquired.meta.changes) return { ...this.status(), skipped: 'running' };
    this.recover(row, token); row = this.row(); settings = this.settings(row);
    if (!this.due(row, settings)) {
      this.database.prepare("UPDATE collection_state SET lease_token=NULL,lease_expires_at=NULL,active_run_id=NULL WHERE owner_id='owner' AND lease_token=?").bind(token).run();
      return { ...this.status(), skipped: 'recovered' };
    }
    const scheduled = settings.enabled && row.next_run_at <= iso(this.now());
    const trigger = row.queued ? 'manual' : scheduled ? 'scheduled' : 'retry';
    const run = { id: 'collection-' + randomUUID(), trigger, queries: 0, found: 0, added: 0, duplicates: 0, summarized: 0, errors: [], failures: 0, successfulQueries: 0, retryAt: this.now() + 15 * MINUTE };
    const deadline = this.now() + COLLECTION_RUN_TIMEOUT_MS;
    let terminal = null;
    this.database.batch([
      this.database.prepare("INSERT INTO collection_runs(id,trigger,status,started_at,retry_of) VALUES(?,?,'running',?,?)").bind(run.id, trigger, iso(this.now()), trigger === 'retry' ? row.retry_of : null),
      this.database.prepare("UPDATE collection_state SET active_run_id=?,queued=0,queued_at=NULL,retry_at=NULL,retry_of=NULL,next_run_at=? WHERE owner_id='owner' AND lease_token=?")
        .bind(run.id, scheduled ? nextCollectionRunAt(this.now(), settings.hour) : row.next_run_at, token),
    ]);
    try {
      const tasks = this.plan(settings, adapters.capabilities || {}, row, trigger, run);
      this.database.prepare('UPDATE collection_runs SET plan_json=? WHERE id=?').bind(JSON.stringify(tasks), run.id).run();
      if (!tasks.length) terminal = 'skipped';
      else {
        const existing = await this.call(token, deadline, (signal) => adapters.getArticles({ signal }));
        const seen = new Set();
        for (const article of existing) { try { seen.add(adapters.canonicalUrl(article.url)); } catch { /* Invalid old rows never delete anything. */ } }
        for (const [taskIndex, task] of tasks.entries()) {
          this.checkpoint(token, deadline);
          if (run.added >= settings.maxNewPerRun) break;
          if (run.rotation?.total) this.database.prepare("UPDATE collection_state SET topic_cursor=? WHERE owner_id='owner' AND lease_token=?")
            .bind((run.rotation.start + taskIndex + 1) % run.rotation.total, token).run();
          const current = this.settings();
          if (task.source === 'pubmed' ? !current.pubmed : !current.web) continue;
          const candidates = await this.query(task, adapters, run, token, deadline);
          run.found += candidates.length;
          let queryAdded = 0;
          for (const original of candidates) {
            this.checkpoint(token, deadline);
            if (run.added >= settings.maxNewPerRun || queryAdded >= PER_QUERY_ADD_CAP) break;
            let url;
            try { url = adapters.canonicalUrl(original.url); }
            catch { this.warning(run, '检索结果缺少有效的原始链接，已跳过。'); continue; }
            if (seen.has(url)) { run.duplicates++; continue; }
            seen.add(url);
            let article = { ...original, url };
            const latestSettings = this.settings();
            if (latestSettings.summarize && adapters.capabilities?.llm) {
              const pause = this.backoff('llm');
              if (pause) { this.warning(run, '中文解读处于上游退避期，已保留原始摘要。'); run.retryAt = Math.max(run.retryAt, pause); }
              else if (!this.reserve('llm', token, deadline)) this.warning(run, '今日中文解读预算已用完，新增资料保留原始摘要。');
              else {
                try {
                  const generated = await this.call(token, deadline, (signal) => adapters.summarize(article, { signal }));
                  if (!generated || typeof generated.summary !== 'string' || !generated.summary.trim()) throw internalError('invalid-result');
                  const editorial = Object.fromEntries(['title', 'originalTitle', 'summary', 'keyPoints', 'limitations', 'topics', 'deepDive'].filter((key) => Object.hasOwn(generated, key)).map((key) => [key, generated[key]]));
                  article = { ...article, ...editorial }; run.summarized++;
                } catch (error) {
                  if (error?.collectionCode === 'lease-lost' || error?.collectionCode === 'deadline') throw error;
                  const info = errorInfo(error, this.now()); this.rememberBackoff('llm', info.retryAt);
                  this.warning(run, safeFailure('llm', info)); run.failures++; run.retryAt = Math.max(run.retryAt, info.retryAt || 0);
                }
              }
            }
            try {
              const inserted = await this.call(token, deadline, (signal) => adapters.insert(article, { signal }));
              if (inserted) { run.added++; queryAdded++; } else run.duplicates++;
            } catch (error) {
              if (error?.collectionCode === 'lease-lost' || error?.collectionCode === 'deadline') throw error;
              this.warning(run, safeFailure('storage', errorInfo(error, this.now()))); run.failures++;
            }
            this.progress(run, token);
          }
          this.progress(run, token);
        }
      }
    } catch (error) {
      if (error?.collectionCode === 'lease-lost') return { ...this.status(), skipped: 'lease-lost' };
      this.warning(run, safeFailure('storage', errorInfo(error, this.now()))); run.failures++;
    }
    terminal ||= run.errors.length ? (run.added || run.successfulQueries ? 'partial' : run.failures ? 'failed' : 'skipped') : 'success';
    const retry = run.failures > 0 && trigger !== 'retry' && this.settings().enabled ? iso(Math.max(this.now() + 15 * MINUTE, run.retryAt)) : null;
    this.database.batch([
      this.database.prepare("UPDATE collection_runs SET status=?,finished_at=?,queries=?,found=?,added=?,duplicates=?,summarized=?,errors_json=? WHERE id=? AND status='running' AND EXISTS(SELECT 1 FROM collection_state WHERE owner_id='owner' AND lease_token=?)")
        .bind(terminal, iso(this.now()), run.queries, run.found, run.added, run.duplicates, run.summarized, JSON.stringify(run.errors), run.id, token),
      this.database.prepare("UPDATE collection_state SET lease_token=NULL,lease_expires_at=NULL,active_run_id=NULL,retry_at=?,retry_of=? WHERE owner_id='owner' AND lease_token=?")
        .bind(retry, retry ? run.id : null, token),
    ]);
    return this.status();
  }
}
