import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, cp, mkdir, readFile, rm, access, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = process.cwd();
const standalone = path.join(root, '.next', 'standalone');
await access(path.join(standalone, 'server.js'));
await mkdir(path.join(standalone, '.next'), { recursive: true });
await cp(path.join(root, 'public'), path.join(standalone, 'public'), { recursive: true });
await cp(path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static'), { recursive: true });
await cp(path.join(root, 'drizzle'), path.join(standalone, 'drizzle'), { recursive: true });
const temporary = await mkdtemp(path.join(tmpdir(), 'molbrief-production-smoke-'));
const listener = createServer();
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const origin = 'http://127.0.0.1:' + port;
const password = randomBytes(24).toString('hex');
const salt = randomBytes(16);
const passwordHash = 'scrypt:' + salt.toString('hex') + ':' + scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
const serviceToken = randomBytes(32).toString('hex');
const environment = {
  ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', HOSTNAME: '127.0.0.1', PORT: String(port),
  APP_ORIGIN: origin, ADMIN_USERNAME: 'smoke-owner', ADMIN_PASSWORD_HASH: passwordHash,
  SESSION_SECRET: randomBytes(32).toString('hex'), INGEST_API_TOKEN: serviceToken,
  DATA_DIR: path.join(temporary, 'var'), MIGRATIONS_DIR: path.join(root, 'drizzle'),
  PARALLEL_API_KEY: '', LLM_API_KEY: '', LLM_BASE_URL: '', LLM_MODEL: '', MINIMAX_API_KEY: '', MINIMAX_VOICE_ID: '', MINIMAX_MODEL: '',
};
const dummyModelKey = 'smoke-test-only-key-never-sent-to-provider';
let server, logs = '', cookie = '', checks = 0;
function pass(name) { checks++; console.log('PASS ' + name); }
async function request(route, { body, method = body ? 'POST' : 'GET', session = false, service = false, headers = {} } = {}) {
  return fetch(origin + route, {
    method, headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}), ...(session ? { Cookie: cookie } : {}),
      ...(service ? { Authorization: 'Bearer ' + serviceToken } : {}), ...headers,
    },
    body: body ? JSON.stringify(body) : undefined, redirect: 'manual', signal: AbortSignal.timeout(15000),
  });
}
async function ownerJson(route, body) {
  const response = await request(route, { session: true, body });
  assert.equal(response.status, 200, route + ' expected HTTP 200');
  return response.json();
}
async function start() {
  server = spawn(process.execPath, [path.join(standalone, 'server.js')], { cwd: standalone, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [server.stdout, server.stderr]) stream.on('data', data => { logs = (logs + data.toString()).slice(-15000); });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error('Production server exited before readiness.');
    try { if ((await request('/api/health')).status === 200) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Production server did not become ready.');
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  const running = server;
  await new Promise(resolve => {
    const timer = setTimeout(() => running.kill('SIGKILL'), 5000);
    running.once('exit', () => { clearTimeout(timer); resolve(); }); running.kill('SIGTERM');
  });
}
async function backupInto(parent) {
  const backup = spawn(process.execPath, ['scripts/backup.mjs', parent], { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', failure = '';
  backup.stdout.on('data', data => output += data);
  backup.stderr.on('data', data => failure += data);
  const exit = await new Promise(resolve => backup.once('exit', resolve));
  assert.equal(exit, 0, 'backup command failed');
  const result = JSON.parse(output);
  const metadata = JSON.parse(await readFile(path.join(result.destination, 'backup.json'), 'utf8'));
  assert.equal(metadata.version, 2); assert.equal(metadata.includesEnvironment, false);
  await assert.rejects(access(path.join(result.destination, '.env')));
  assert.equal((await stat(path.join(result.destination, 'backup.json'))).mode & 0o777, 0o600);
  assert.ok(!failure.includes(dummyModelKey));
  return { result, metadata };
}

try {
  await start(); pass('standalone server starts with SQLite migrations');
  let response = await request('/');
  assert.ok([302, 303, 307].includes(response.status));
  assert.ok(response.headers.get('location')?.endsWith('/login'));
  pass('home requires the independent account');
  for (const route of ['/topics', '/settings', '/knowledge', '/knowledge/drug-duvakitug', '/targets']) {
    response = await request(route);
    assert.ok([302, 303, 307, 308].includes(response.status), route + ' requires login');
    assert.ok(response.headers.get('location')?.endsWith('/login'));
  }
  pass('keyword, settings and knowledge routes including entity deep links require login');
  response = await request('/login'); assert.equal(response.status, 200); assert.ok((await response.text()).includes('账号'));
  pass('login form renders');
  response = await request('/api/feed', { headers: { 'oai-authenticated-user-id': 'fake', 'oai-authenticated-user-email': 'fake@example.com' } });
  assert.equal(response.status, 401); pass('old hosting identity headers cannot authenticate');
  for (const route of ['/api/settings', '/api/knowledge', '/api/target-research?q=EGFR']) {
    assert.equal((await request(route)).status, 401);
    assert.equal((await request(route, { service: true })).status, 401);
  }
  assert.equal((await request('/api/settings', { body: { action: 'save', values: {} } })).status, 401);
  assert.equal((await request('/api/settings', { service: true, body: { action: 'save', values: {} } })).status, 401);
  pass('settings and knowledge APIs reject anonymous visitors and service tokens');
  assert.equal((await request('/api/session', { body: { username: 'smoke-owner', password: 'incorrect' } })).status, 401);
  response = await request('/api/session', { body: { username: 'smoke-owner', password }, headers: { Origin: origin } });
  assert.equal(response.status, 200); assert.ok(response.headers.get('set-cookie')?.includes('HttpOnly'));
  cookie = response.headers.get('set-cookie').split(';')[0];
  pass('password login sets an HttpOnly session');
  let state = await ownerJson('/api/state');
  assert.equal(state.signedIn, true); assert.equal(state.topics.length, 4); assert.equal(state.capabilities.llm, false);
  pass('owner preferences initialize once and APIs remain unconfigured');

  assert.equal((await request('/api/collection')).status, 401);
  assert.equal((await request('/api/collection', { service: true })).status, 401);
  assert.equal((await request('/api/collection', { service: true, body: { action: 'run' } })).status, 401);
  assert.equal((await request('/api/collection/tick', { body: {} })).status, 401);
  assert.equal((await request('/api/collection/tick', { session: true, body: {} })).status, 401);
  pass('collection settings require owner and worker execution requires its service token');
  let collection = await ownerJson('/api/collection');
  assert.equal(collection.settings.hour, 8); assert.equal(collection.settings.pubmed, true);
  assert.equal(collection.settings.web, false); assert.equal(collection.settings.summarize, false);
  assert.ok(!JSON.stringify(collection).includes(serviceToken));
  assert.ok(!JSON.stringify(collection).includes(environment.SESSION_SECRET));
  assert.equal((await request('/api/collection', { session: true, body: { action: 'save', settings: { hour: 99 } } })).status, 400);
  assert.equal((await request('/api/collection', { session: true, body: { action: 'save', settings: { enabled: false } }, headers: { Origin: 'https://different.example' } })).status, 403);
  assert.equal((await request('/api/collection/tick', { service: true, body: {}, headers: { Origin: 'https://different.example' } })).status, 403);
  collection = await ownerJson('/api/collection', { action: 'save', settings: { enabled: false, hour: 9, maxNewPerRun: 3 } });
  assert.equal(collection.settings.enabled, false); assert.equal(collection.settings.hour, 9);
  pass('collection schedule is explicit, secret-free and validates same-origin settings');
  response = await request('/api/collection/tick', { service: true, body: {}, headers: { Origin: origin } });
  assert.equal(response.status, 200);
  collection = await response.json();
  assert.equal(collection.worker.healthy, true); assert.equal(collection.runs.length, 0);
  assert.equal((await request('/api/collection',{session:true,body:{action:'run',mode:'unknown'}})).status,400);
  assert.equal((await request('/api/collection',{session:true,body:{action:'run',mode:'summarize',limit:0}})).status,400);
  response=await request('/api/collection',{session:true,body:{action:'run',mode:'summarize',limit:1}});
  assert.equal(response.status,202);
  response=await request('/api/collection/tick',{service:true,body:{},headers:{Origin:origin}});
  assert.equal(response.status,200);collection=await response.json();
  assert.equal(collection.runs[0].mode,'summarize');assert.equal(collection.runs[0].summaryAttempts,0);
  assert.equal(collection.runs[0].stage,'finished');assert.equal(collection.today.summaries,0);
  pass('backfill mode validates per-run limits and completes safely without a configured model or paid calls');
  response = await request('/api/collection', { session: true, body: { action: 'run' } });
  assert.equal(response.status, 202); assert.equal((await response.json()).queued, true);
  response = await request('/api/collection', { session: true, body: { action: 'run' } });
  assert.equal(response.status, 202); assert.equal((await response.json()).queued, true);
  pass('worker heartbeat without a due job makes no provider calls and owner can queue one manual run');

  const emptyBackup = await backupInto(path.join(temporary, 'before-settings-backups'));
  assert.equal(emptyBackup.metadata.containsEncryptedServiceCredentials, false);
  assert.equal(emptyBackup.metadata.requiresSessionSecretForSettingsRestore, false);
  assert.equal(emptyBackup.metadata.includesSecrets, false); assert.equal(emptyBackup.result.secretsIncluded, false);
  pass('backup without saved service settings excludes environment and reports no encrypted credentials');

  const feed = await ownerJson('/api/feed');
  assert.equal(feed.articles.length, 8); const article = feed.articles[0];
  pass('eight source-backed articles are readable');
  state = await ownerJson('/api/reading', { articleId: article.id, action: 'save', value: true });
  assert.ok(state.saved.includes(article.id)); pass('bookmark persists through the API');
  state = await ownerJson('/api/preferences', { speed: 1.2 });
  assert.equal(state.preferences.speed, 1.2); pass('reading preference updates persist');

  const topicName = '冒烟验收中文关键词';
  state = await ownerJson('/api/topics', { action: 'add', name: topicName, query: 'nanobody delivery' });
  const topic = state.topics.find(item => item.name === topicName);
  assert.ok(topic); assert.equal(topic.query, 'nanobody delivery');
  state = await ownerJson('/api/topics', { action: 'add', name: ' ' + topicName + ' ', query: 'duplicate ignored' });
  assert.equal(state.topics.filter(item => item.name === topicName).length, 1); assert.equal(state.topics.length, 5);
  pass('Chinese keywords are stored and duplicate submissions do not duplicate topics');
  state = await ownerJson('/api/topics', { action: 'update', id: topic.id, query: 'nanobody delivery formulation' });
  assert.equal(state.topics.find(item => item.id === topic.id).query, 'nanobody delivery formulation');
  assert.equal((await request('/api/topics', { session: true, body: { action: 'update', id: topic.id, query: '' } })).status, 400);
  assert.equal((await request('/api/topics', { session: true, body: { action: 'update', id: topic.id, query: 'blocked' }, headers: { Origin: 'https://different.example' } })).status, 403);
  state = await ownerJson('/api/topics', { action: 'remove', id: topic.id });
  assert.ok(!state.topics.some(item => item.id === topic.id)); assert.equal(state.topics.length, 4);
  pass('keyword search expressions update, validate and clean up without paid calls');

  assert.equal((await request('/api/preferences', { session: true, body: { speed: 999 } })).status, 400);
  pass('invalid preference data is rejected');
  assert.equal((await request('/api/reading', { session: true, body: { articleId: article.id, action: 'save', value: false }, headers: { Origin: 'https://different.example' } })).status, 403);
  pass('cross-origin mutations are rejected');
  assert.equal((await request('/api/state', { headers: { Cookie: cookie + 'x' } })).status, 401);
  pass('tampered cookies are rejected');
  assert.equal((await request('/api/search', { session: true, body: { query: 'nanobody', source: 'web' } })).status, 501);
  pass('missing paid service returns an explicit configuration state');

  let settings = await ownerJson('/api/settings');
  assert.deepEqual(settings.fields.LLM_API_KEY, { present: false, source: 'empty' });
  assert.ok(!JSON.stringify(settings).includes(environment.SESSION_SECRET));
  assert.ok(!JSON.stringify(settings).includes(serviceToken));
  assert.equal((await request('/api/settings', { session: true, body: { action: 'save', values: { LLM_MODEL: 'blocked' } }, headers: { Origin: 'https://different.example' } })).status, 403);
  assert.equal((await request('/api/settings', { session: true, body: { action: 'verify', service: 'llm' }, headers: { Origin: 'https://different.example' } })).status, 403);
  pass('owner can inspect secret-free settings and cross-origin save or verification is rejected');
  settings = await ownerJson('/api/settings', { action: 'save', values: {
    LLM_BASE_URL: 'https://never-contact.example.invalid/v1', LLM_MODEL: 'smoke-test-model', LLM_API_KEY: dummyModelKey,
    MINIMAX_MODEL: 'smoke-test-voice-model',
  } });
  assert.equal(settings.services.llm.status, 'configured'); assert.equal(settings.services.llm.verifiedAt, null);
  assert.equal(settings.fields.LLM_API_KEY.present, true); assert.equal(settings.fields.LLM_API_KEY.value, undefined);
  assert.ok(!JSON.stringify(settings).includes(dummyModelKey));
  state = await ownerJson('/api/state'); assert.equal(state.capabilities.llm, true);
  pass('saved test-only model configuration takes effect immediately without exposing its key');
  response=await request('/api/summarize',{session:true,body:{article},headers:{Origin:origin}});
  assert.equal(response.status,202);const summaryJob=(await response.json()).job;
  assert.equal(summaryJob.status,'queued');
  response=await request('/api/summarize',{session:true,body:{article},headers:{Origin:origin}});
  assert.equal((await response.json()).job.id,summaryJob.id);
  assert.equal((await request('/api/summary-status/'+summaryJob.id)).status,401);
  assert.equal((await request('/api/summary-status/'+summaryJob.id,{service:true})).status,401);
  assert.equal((await ownerJson('/api/summary-status/'+summaryJob.id)).job.status,'queued');
  assert.equal((await request('/api/summarize',{session:true,body:{article},headers:{Origin:'https://other.example'}})).status,403);
  pass('single summaries return a persistent deduplicated job without a synchronous provider call and status remains owner-only');
  settings = await ownerJson('/api/settings', { action: 'save', values: { LLM_API_KEY: '' } });
  assert.equal(settings.fields.LLM_API_KEY.present, true);
  settings = await ownerJson('/api/settings', { action: 'save', clear: ['LLM_API_KEY'] });
  assert.equal(settings.fields.LLM_API_KEY.present, false); assert.equal(settings.services.llm.status, 'unconfigured');
  state = await ownerJson('/api/state'); assert.equal(state.capabilities.llm, false);
  pass('blank secret input retains a key and explicit clearing disables the model immediately');

  assert.equal((await request('/api/ingest', { session: true, body: { articles: [article] } })).status, 401);
  const exported = JSON.parse(await readFile(path.join(root, 'data', 'content-export.json'), 'utf8'));
  response = await request('/api/ingest', { service: true, body: { articles: exported.articles } });
  assert.equal(response.status, 200); assert.equal((await response.json()).written, 8);
  response = await request('/api/feed', { service: true }); assert.equal(response.status, 200); assert.equal((await response.json()).articles.length, 8);
  pass('service import and deduplicated readback work');
  assert.equal((await request('/api/reading', { service: true, body: { articleId: article.id, action: 'save', value: false } })).status, 401);
  assert.equal((await request('/api/state', { service: true })).status, 401);
  pass('service tokens cannot act as the owner');
  response = await request('/api/update-guide', { service: true }); assert.equal(response.status, 200); assert.ok((await response.json()).requiredFields.includes('readingBasis'));
  pass('unattended update instructions are available with service authorization');

  const richArticle = {
    ...article,
    deepDive: { background: 'Smoke test source-backed editorial context.', keyFindings: ['Recorded from supplied material.'], quantitativeEvidence: [], limitations: ['Test fixture only.'], nextQuestions: [] },
    entities: [{ type: 'drug', name: 'Smoke curated drug', sourceUrl: article.url, provenance: 'curated', facts: [{
      key: 'target', label: '作用靶点', value: 'Smoke curated target', status: 'reported', sourceUrl: article.url,
      sourceDate: article.publishedAt, dateBasis: article.publishedAt ? 'source-publication' : 'unknown', provenance: 'curated', evidence: 'Disposable smoke-test fixture.',
    }] }],
  };
  assert.equal((await request('/api/article', { body: { article: richArticle } })).status, 401);
  assert.equal((await request('/api/article', { service: true, body: { article: richArticle } })).status, 401);
  assert.equal((await request('/api/article', { session: true, body: { article: richArticle }, headers: { Origin: 'https://different.example' } })).status, 403);
  const savedArticle = await ownerJson('/api/article', { article: richArticle });
  assert.equal(savedArticle.article.url, article.url);
  assert.equal(savedArticle.article.deepDive.background, richArticle.deepDive.background);
  assert.equal(savedArticle.article.entities.find(item => item.name === 'Smoke curated drug').facts[0].value, 'Smoke curated target');
  assert.equal((await ownerJson('/api/feed')).articles.length, 8);
  pass('owner-only same-origin article editing preserves rich content and the eight-article collection');
  const directory = await ownerJson('/api/knowledge');
  assert.ok(Array.isArray(directory.drugs));
  const curatedDrug = directory.drugs.find(item => item.name === 'Smoke curated drug');
  assert.ok(curatedDrug); assert.equal(curatedDrug.fields.find(field => field.key === 'target').value, 'Smoke curated target');
  assert.ok(curatedDrug.sourceUrls.includes(article.url));
  pass('knowledge API aggregates the supplied curated entity and its sourced facts');
  response=await request('/api/target-research?id=invalid',{session:true});assert.equal(response.status,400);pass('target query validates IDs before any external request');

  const staleArticle={...article,summary:'A stale search-result abstract.',keyPoints:[]};
  for(const field of ['entities','deepDive','sourceText','sourceReview'])delete staleArticle[field];
  const recollected=await ownerJson('/api/collect',{article:staleArticle});
  assert.equal(recollected.article.summary,savedArticle.article.summary);
  assert.equal(recollected.article.deepDive.background,richArticle.deepDive.background);
  assert.ok(recollected.article.entities.some(e=>e.name==='Smoke curated drug'));
  assert.ok(recollected.saved.includes(article.id));
  pass('collecting a stale search result returns the stored article without overwriting reviewed evidence');

  response=await request('/api/ingest',{service:true,body:{articles:['A','B'].map(name=>({...staleArticle,entities:[{type:'company',name:'Smoke appended company '+name,sourceUrl:article.url,provenance:'curated',facts:[]}]}))}});
  assert.equal(response.status,200);
  const supplemented=(await ownerJson('/api/feed')).articles.find(item=>item.url===article.url);
  for(const name of ['Smoke curated drug','Smoke appended company A','Smoke appended company B'])assert.ok(supplemented.entities.some(e=>e.name===name));
  assert.equal(supplemented.deepDive.background,richArticle.deepDive.background);
  pass('successive updates to one URL in the same ingest batch retain earlier and newly supplied evidence');

  response = await request('/manifest.webmanifest'); assert.equal(response.status, 200);
  const manifest = await response.json(); assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
  assert.equal((await request('/icon-192.png')).status, 200);
  response = await request('/', { session: true }); assert.equal(response.status, 200);
  const html = await response.text(); assert.ok(html.includes('今天，读一点新进展'));
  const css = html.match(/href="([^\"]*\/_next\/static\/[^\"]+\.css[^\"]*)"/); assert.ok(css);
  assert.equal((await request(css[1].replaceAll('&amp;', '&'))).status, 200);
  pass('home HTML, styles and PWA assets are served by the standalone bundle');
  for (const [route, marker] of [['/topics', 'topic-name'], ['/settings', '服务连接'], ['/knowledge', '知识库'], ['/knowledge/drug-duvakitug', '知识库'], ['/targets','查询靶点']]) {
    response = await request(route, { session: true }); assert.equal(response.status, 200, route + ' page');
    assert.ok((await response.text()).includes(marker), route + ' expected page content');
  }
  pass('direct keyword, configuration, knowledge and entity pages render their intended sections');

  const historyDatabase = new DatabaseSync(path.join(environment.DATA_DIR, 'molbrief.sqlite'));
  try {
    const insert = historyDatabase.prepare('INSERT INTO articles(id,canonical_url,payload,collected_at) VALUES(?,?,?,?)');
    historyDatabase.exec('BEGIN');
    try {
      for (let index = 0; index < 205; index++) {
        const id = 'smoke-history-' + index, url = 'https://history.example.invalid/' + index;
        const collectedAt = new Date(Date.UTC(2000, 0, 1, 0, 0, index)).toISOString();
        const historicalArticle = {
          ...article, id, url, title: 'Disposable historical fixture ' + index,
          publishedAt: null, collectedAt, topics: [],
          entities: index === 0 ? [{ type: 'target', name: 'Smoke earliest historical target', sourceUrl: url, provenance: 'curated', facts: [] }] : [],
        };
        insert.run(id, url, JSON.stringify(historicalArticle), collectedAt);
      }
      historyDatabase.exec('COMMIT');
    } catch (error) { historyDatabase.exec('ROLLBACK'); throw error; }
    const completeFeed = await ownerJson('/api/feed');
    assert.equal(completeFeed.articles.length, 213);
    assert.ok(completeFeed.articles.some(item => item.id === 'smoke-history-0'));
    const completeDirectory = await ownerJson('/api/knowledge');
    assert.ok(completeDirectory.targets.some(item => item.name === 'Smoke earliest historical target'));
    pass('older unbookmarked evidence remains in the library and knowledge directory beyond 200 articles');
  } finally {
    historyDatabase.prepare("DELETE FROM articles WHERE id GLOB 'smoke-history-*'").run();
    historyDatabase.close();
  }
  assert.equal((await ownerJson('/api/feed')).articles.length, 8);

  await stop(); await start();
  state = await ownerJson('/api/state');
  assert.ok(state.saved.includes(article.id)); assert.equal(state.preferences.speed, 1.2); assert.equal(state.topics.length, 4);
  assert.equal(state.capabilities.llm, false); assert.equal(state.capabilities.tts, false);
  settings = await ownerJson('/api/settings');
  assert.equal(settings.fields.LLM_MODEL.value, 'smoke-test-model'); assert.equal(settings.fields.LLM_MODEL.source, 'database');
  assert.equal(settings.fields.MINIMAX_MODEL.value, 'smoke-test-voice-model');
  assert.equal(settings.services.llm.status, 'unconfigured'); assert.ok(!JSON.stringify(settings).includes(dummyModelKey));
  assert.ok((await ownerJson('/api/feed')).articles.some(item => item.entities?.some(entity => entity.name === 'Smoke curated drug')));
  pass('bookmarks, preferences, rich article edits and encrypted settings survive a process restart');
  collection = await ownerJson('/api/collection');
  assert.equal(collection.settings.hour, 9); assert.equal(collection.settings.maxNewPerRun, 3);
  assert.equal(collection.settings.enabled, false); assert.equal(collection.queued, true);
  pass('collection settings, queued request and schedule survive a production process restart');
  assert.equal((await ownerJson('/api/summary-status/'+summaryJob.id)).job.status,'queued');
  pass('queued single-article summary jobs survive a production process restart without silently invoking a provider');
  response = await request('/api/session', { session: true, body: { action: 'logout' }, headers: { Origin: origin } });
  assert.equal(response.status, 200); assert.ok(response.headers.get('set-cookie')?.toLowerCase().includes('max-age=0'));
  pass('logout clears the browser session cookie');

  const privateBackup = await backupInto(path.join(temporary, 'after-settings-backups'));
  assert.equal(privateBackup.metadata.containsEncryptedServiceCredentials, true);
  assert.equal(privateBackup.metadata.requiresSessionSecretForSettingsRestore, true);
  assert.equal(privateBackup.metadata.includesSecrets, true); assert.equal(privateBackup.result.secretsIncluded, true);
  const snapshotPath = path.join(privateBackup.result.destination, 'molbrief.sqlite');
  const snapshot = new DatabaseSync(snapshotPath, { readOnly: true });
  try {
    assert.equal(snapshot.prepare('SELECT count(*) AS n FROM service_settings').get().n, 1);
    assert.equal(snapshot.prepare("SELECT saved FROM reading_state WHERE user_id='owner' AND article_id=?").get(article.id).saved, 1);
  } finally { snapshot.close(); }
  assert.ok(!(await readFile(snapshotPath)).includes(Buffer.from(dummyModelKey)));
  pass('private backup reads back saved data and labels encrypted credentials and key requirements accurately');
  console.log(JSON.stringify({ productionSmoke: 'passed', checks, paidApiCalls: 0, dockerEngineTested: false }));
} catch (error) {
  console.error('SMOKE FAILURE:', error.message); console.error(logs.slice(-1600)); process.exitCode = 1;
} finally { await stop(); await rm(temporary, { recursive: true, force: true }); }
