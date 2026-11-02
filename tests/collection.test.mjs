import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { LocalDatabase } from '../lib/storage-core.mjs';
import { CollectionStore, CollectionError, DEFAULT_COLLECTION_SETTINGS, COLLECTION_LEASE_MS, COLLECTION_RUN_TIMEOUT_MS, nextCollectionRunAt, beijingDay } from '../lib/collection-core.mjs';

const MINUTE = 60000, HOUR = 60 * MINUTE;
const INITIAL = Date.UTC(2026, 10, 3, 4); // Beijing noon, independent of host TZ.
const canonicalUrl = (input) => {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid source');
  url.hash = ''; url.searchParams.delete('utm_source'); return url.href;
};
function article(name, additions = {}) {
  const url = 'https://example.invalid/material/' + encodeURIComponent(name);
  return { id: 'art-' + createHash('sha256').update(url).digest('hex').slice(0, 16), url, title: name,
    category: '研究', publishedAt: null, collectedAt: '2026-11-03T04:00:00.000Z', source: 'Test primary source',
    type: '论文记录', summary: 'Original abstract only.', keyPoints: [], limitations: 'Not full text.',
    topics: [], readingBasis: 'PubMed 原始摘要', group: '检索结果', ...additions };
}
async function fixture(t, settings = {}, initial = INITIAL) {
  const directory = await mkdtemp(path.join(tmpdir(), 'molbrief-collection-'));
  const connections = [], clock = { value: initial };
  const open = () => { const database = new LocalDatabase({ dataDir: directory }); connections.push(database); return database; };
  const database = open(), store = new CollectionStore({ database, now: () => clock.value });
  t.after(async () => { for (const item of connections) { try { item.close(); } catch {} } await rm(directory, { recursive: true, force: true }); });
  store.save(settings);
  const addTopic = (id, { name = id, query = id, expiresAt = null, user = 'owner' } = {}) => database.prepare('INSERT INTO topics(id,user_id,name,query,kind,created_at,expires_at) VALUES(?,?,?,?,?,?,?)')
    .bind(id, user, name, query, expiresAt ? 'explore' : 'core', '2026-11-01T00:00:00.000Z', expiresAt).run();
  const calls = [], summaries = [];
  const adapters = {
    capabilities: { parallel: false, llm: false }, canonicalUrl,
    search: async (query, source) => { calls.push({ query, source }); return Array.from({ length: 8 }, (_, i) => article(query + '-' + i)); },
    getArticles: async () => database.prepare('SELECT payload FROM articles').all().results.map(row => JSON.parse(row.payload)),
    insert: async (item) => !!database.prepare('INSERT OR IGNORE INTO articles(id,canonical_url,payload,collected_at) VALUES(?,?,?,?)')
      .bind(item.id, canonicalUrl(item.url), JSON.stringify(item), item.collectedAt).run().meta.changes,
    summarize: async (item) => { summaries.push(item.url); return { ...item, summary: 'Expanded from supplied material.' }; },
  };
  return { directory, open, database, store, clock, addTopic, adapters, calls, summaries };
}
const runNow = async (store, adapters) => { store.enqueue(); return store.tick(adapters); };

test('Beijing daily schedule, settings validation and heartbeat are independent of host timezone', async t => {
  const initial = Date.UTC(2026, 10, 2, 23, 30), f = await fixture(t, {}, initial);
  assert.deepEqual(f.store.status().settings, DEFAULT_COLLECTION_SETTINGS);
  assert.equal(f.store.status().nextRunAt, '2026-11-03T00:00:00.000Z');
  assert.equal(nextCollectionRunAt(Date.UTC(2026, 10, 3), 8), '2026-11-04T00:00:00.000Z');
  assert.equal(beijingDay(Date.UTC(2026, 10, 3, 15, 59)), '2026-11-03');
  assert.equal(beijingDay(Date.UTC(2026, 10, 3, 16)), '2026-11-04');
  for (const invalid of [{ hour: 24 }, { maxNewPerRun: 31 }, { maxQueriesPerRun: 0 }, { maxSummariesPerDay: -1 }, { enabled: 'true' }, { apiKey: 'not-supported' }]) assert.throws(() => f.store.save(invalid), CollectionError);
  assert.equal(f.store.status().worker.healthy, false);
  const idle = await f.store.tick(f.adapters);
  assert.equal(idle.skipped, 'not-due'); assert.equal(idle.worker.healthy, true); assert.equal(f.calls.length, 0);
  f.clock.value += 4 * MINUTE;
  assert.equal(f.store.status().worker.healthy, false);
  assert.equal(f.store.save({ hour: 20 }).nextRunAt, '2026-11-03T12:00:00.000Z');
});

test('scheduled runs occur once at 08:00 and restart preserves the next day and run history', async t => {
  const f = await fixture(t, {}, Date.UTC(2026, 10, 2, 23, 59)); f.addTopic('topic');
  f.clock.value = Date.UTC(2026, 10, 3);
  const result = await f.store.tick(f.adapters);
  assert.equal(result.runs[0].trigger, 'scheduled'); assert.equal(result.runs[0].status, 'success');
  assert.equal(result.runs[0].added, 2); assert.equal(result.nextRunAt, '2026-11-04T00:00:00.000Z');
  assert.equal((await f.store.tick(f.adapters)).runs.length, 1);
  const reopened = new CollectionStore({ database: f.open(), now: () => f.clock.value });
  assert.equal(reopened.status().nextRunAt, result.nextRunAt);
  assert.equal(reopened.status().runs[0].id, result.runs[0].id);
});

test('manual enqueue coalesces repeated clicks and is allowed when daily scheduling is disabled', async t => {
  const f = await fixture(t, { enabled: false }); f.addTopic('topic');
  f.store.enqueue(); f.store.enqueue(); f.store.enqueue();
  assert.equal(f.store.status().queued, true); assert.equal(f.store.status().nextRunAt, null);
  const result = await f.store.tick(f.adapters);
  assert.equal(result.runs.length, 1); assert.equal(result.runs[0].trigger, 'manual'); assert.equal(result.runs[0].added, 2);
  assert.equal(result.queued, false); assert.equal((await f.store.tick(f.adapters)).runs.length, 1);
});

test('only owner unexpired topics are searched, using query for PubMed and name for web', async t => {
  const f = await fixture(t, { web: true });
  f.adapters.capabilities.parallel = true;
  f.addTopic('valid', { name: '中文显示名', query: 'nanobody[Title/Abstract]' });
  f.addTopic('expired', { expiresAt: new Date(f.clock.value).toISOString() });
  f.addTopic('other-user', { user: 'someone-else' });
  const result = await runNow(f.store, f.adapters);
  assert.deepEqual(f.calls, [{ query: 'nanobody[Title/Abstract]', source: 'pubmed' }, { query: '中文显示名', source: 'web' }]);
  assert.equal(result.today.webQueries, 1);
});

test('two additions per topic distribute a run and actual-task rotation eventually reaches all forty topics', async t => {
  const f = await fixture(t, { maxQueriesPerRun: 8, maxNewPerRun: 12 });
  for (let i = 0; i < 40; i++) f.addTopic('topic-' + String(i).padStart(2, '0'));
  for (let i = 0; i < 7; i++) {
    const before = new Set((await f.adapters.getArticles()).map(item => item.id));
    const result = await runNow(f.store, f.adapters);
    assert.ok(result.runs[0].added <= 12); assert.ok(result.runs[0].queries <= 8);
    const addedPerTopic = new Map();
    for (const item of (await f.adapters.getArticles()).filter(item => !before.has(item.id))) {
      const topic = item.title.replace(/-\d+$/, ''); addedPerTopic.set(topic, (addedPerTopic.get(topic) || 0) + 1);
    }
    assert.ok([...addedPerTopic.values()].every(count => count <= 2));
  }
  assert.equal(new Set(f.calls.map(call => call.query)).size, 40);
  const countByTopic = new Map();
  for (const item of await f.adapters.getArticles()) { const topic = item.title.replace(/-\d+$/, ''); countByTopic.set(topic, (countByTopic.get(topic) || 0) + 1); }
  assert.equal([...countByTopic.values()].every(count => count >= 2), true);
});

test('existing URLs and cross-query duplicates are skipped before model calls without touching personal state', async t => {
  const f = await fixture(t, { summarize: true, maxSummariesPerDay: 30 }); f.adapters.capabilities.llm = true;
  const original = article('existing', { summary: 'Human-curated material.', entities: [{ type: 'drug', name: 'Reviewed drug' }] });
  await f.adapters.insert(original);
  f.database.prepare("INSERT INTO reading_state(user_id,article_id,saved,read) VALUES('owner',?,1,1)").bind(original.id).run();
  f.database.prepare("INSERT INTO preferences(user_id,payload) VALUES('owner',?)").bind('{"speed":1.5}').run();
  f.addTopic('a'); f.addTopic('b');
  f.adapters.search = async query => [article('existing', { url: original.url + '?utm_source=test' }), article('shared'), article(query + '-unique')];
  const result = await runNow(f.store, f.adapters), log = result.runs[0];
  assert.equal(log.added, 3); assert.equal(log.duplicates, 3); assert.equal(log.summarized, 3);
  assert.equal(f.summaries.includes(original.url), false);
  assert.equal((await f.adapters.getArticles()).find(item => item.id === original.id).summary, original.summary);
  assert.deepEqual({ ...f.database.prepare('SELECT saved,read FROM reading_state WHERE article_id=?').bind(original.id).first() }, { saved: 1, read: 1 });
  assert.equal(f.database.prepare("SELECT payload FROM preferences WHERE user_id='owner'").first().payload, '{"speed":1.5}');
});

test('success search cache survives store restart and avoids repeated paid queries for one hour', async t => {
  const f = await fixture(t, { pubmed: false, web: true }); f.adapters.capabilities.parallel = true; f.addTopic('web-topic');
  const first = await runNow(f.store, f.adapters);
  assert.equal(first.today.webQueries, 1);
  const reopened = new CollectionStore({ database: f.open(), now: () => f.clock.value });
  const cached = await runNow(reopened, f.adapters);
  assert.equal(cached.today.webQueries, 1); assert.equal(cached.runs[0].queries, 0); assert.equal(cached.runs[0].added, 2);
  assert.equal(f.calls.length, 1); // Cached candidates can add the next two previously unseen records.
  f.clock.value += HOUR + 1;
  await runNow(reopened, f.adapters); assert.equal(f.calls.length, 2);
});

test('paid budgets are reserved before calls, include failures, and reset at Beijing midnight', async t => {
  const f = await fixture(t, { pubmed: false, web: true, maxQueriesPerRun: 1, maxWebQueriesPerDay: 2 });
  f.adapters.capabilities.parallel = true;
  for (const id of ['a', 'b', 'c']) f.addTopic(id);
  const secret = 'test-provider-token-that-must-not-be-logged'; let calls = 0;
  f.adapters.search = async () => { calls++; assert.equal(f.store.status().today.webQueries, calls); throw Object.assign(new Error(secret), { status: 502 }); };
  for (let i = 0; i < 4; i++) await runNow(f.store, f.adapters);
  assert.equal(calls, 2); assert.equal(f.store.status().today.webQueries, 2);
  assert.equal(JSON.stringify(f.store.status()).includes(secret), false);
  assert.equal(JSON.stringify(f.database.prepare('SELECT payload_json FROM collection_cache').all().results).includes(secret), false);
  f.clock.value = Date.UTC(2026, 10, 3, 16);
  assert.equal(f.store.status().today.webQueries, 0);
  f.adapters.search = async () => { calls++; assert.equal(f.store.status().today.webQueries, 1); return []; };
  await runNow(f.store, f.adapters); assert.equal(calls, 3);
});

test('missing paid configuration and exhausted model budget keep original abstracts available', async t => {
  const f = await fixture(t, { web: true, summarize: true }); f.addTopic('topic');
  const missing = await runNow(f.store, f.adapters);
  assert.equal(missing.runs[0].added, 2); assert.equal(missing.today.webQueries, 0); assert.equal(missing.today.summaries, 0);
  assert.ok(missing.runs[0].errors.some(error => error.includes('未配置')));
  f.adapters.capabilities.llm = true; f.store.save({ maxSummariesPerDay: 1 });
  const result = await runNow(f.store, f.adapters);
  assert.equal(result.today.summaries, 1); assert.equal(result.runs[0].added, 2); assert.equal(result.runs[0].summarized, 1);
  const records = await f.adapters.getArticles();
  assert.ok(records.some(item => item.summary === 'Original abstract only.'));
  assert.ok(records.some(item => item.summary === 'Expanded from supplied material.'));
});

test('429 backoff and failed-query cache survive requests without retrying or consuming more budget', async t => {
  const f = await fixture(t, { pubmed: false, web: true }); f.adapters.capabilities.parallel = true;
  f.addTopic('a'); f.addTopic('b'); let calls = 0;
  f.adapters.search = async () => { calls++; throw Object.assign(new Error('private response'), { status: 429, retryAfter: 7200 }); };
  const first = await runNow(f.store, f.adapters);
  assert.equal(calls, 1); assert.equal(first.today.webQueries, 1); assert.equal(first.runs[0].status, 'failed');
  assert.equal(first.nextRunAt, new Date(INITIAL + 2 * HOUR).toISOString());
  f.clock.value += 20 * MINUTE;
  const cached = await runNow(f.store, f.adapters);
  assert.equal(calls, 1); assert.equal(cached.today.webQueries, 1);
  assert.ok(cached.runs[0].errors.every(error => !error.includes('private response')));
});

test('a failed run has at most one delayed automatic retry', async t => {
  const f = await fixture(t); f.addTopic('topic'); let calls = 0;
  f.adapters.search = async () => { calls++; throw new Error('untrusted upstream detail'); };
  await runNow(f.store, f.adapters);
  f.clock.value += 16 * MINUTE;
  assert.equal((await f.store.tick(f.adapters)).skipped, 'not-due');
  f.clock.value = INITIAL + HOUR + 1;
  const retried = await f.store.tick(f.adapters);
  assert.equal(retried.runs[0].trigger, 'retry'); assert.equal(calls, 2);
  assert.equal(f.database.prepare("SELECT retry_at FROM collection_state WHERE owner_id='owner'").first().retry_at, null);
  f.clock.value += HOUR + 1;
  await f.store.tick(f.adapters); assert.equal(calls, 2);
});

test('atomic lease prevents overlapping workers and enqueue during an active run does not add another run', async t => {
  const f = await fixture(t); f.addTopic('topic');
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  let calls = 0;
  f.adapters.search = async () => { calls++; entered(); await blocked; return [article('one')]; };
  f.store.enqueue(); const first = f.store.tick(f.adapters); await started;
  const other = new CollectionStore({ database: f.open(), now: () => f.clock.value });
  assert.equal((await other.tick(f.adapters)).skipped, 'running');
  assert.equal(other.enqueue().queued, false); assert.equal(other.status().worker.healthy, true);
  release(); const result = await first;
  assert.equal(calls, 1); assert.equal(result.runs.length, 1); assert.equal(result.runs[0].added, 1);
});

test('expired leases recover interrupted runs and a late old worker cannot insert after losing ownership', async t => {
  const f = await fixture(t); f.addTopic('topic');
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; }), blocked = new Promise(resolve => { release = resolve; });
  f.adapters.search = async () => { entered(); await blocked; return [article('late-result')]; };
  f.store.enqueue(); const pending = f.store.tick(f.adapters); await started;
  f.clock.value += COLLECTION_LEASE_MS + 1;
  const recovered = new CollectionStore({ database: f.open(), now: () => f.clock.value });
  const status = await recovered.tick(f.adapters);
  assert.equal(status.runs[0].status, 'interrupted'); assert.equal(status.running, false);
  assert.equal(status.nextRunAt, new Date(f.clock.value + 15 * MINUTE).toISOString());
  release(); await pending;
  assert.equal((await f.adapters.getArticles()).length, 0);
  assert.equal(recovered.status().runs[0].status, 'interrupted');
});

test('run deadline stops new writes and malformed or failed results never clear the library', async t => {
  const f = await fixture(t); f.addTopic('topic'); await f.adapters.insert(article('human-record'));
  f.adapters.search = async () => { f.clock.value += COLLECTION_RUN_TIMEOUT_MS + 1; return [article('too-late')]; };
  const result = await runNow(f.store, f.adapters);
  assert.equal(result.runs[0].status, 'failed'); assert.equal(result.runs[0].added, 0);
  assert.deepEqual((await f.adapters.getArticles()).map(item => item.title), ['human-record']);
});
