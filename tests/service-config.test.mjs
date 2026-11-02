import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalDatabase } from '../lib/storage-core.mjs';
import { ServiceConfigError, ServiceConfigStore } from '../lib/service-config-core.mjs';

// Disposable test-only credentials. Every provider request below is mocked.
async function fixture(t, additions = {}, fetcher = async () => { throw new Error('unexpected request'); }) {
  const directory = await mkdtemp(path.join(tmpdir(), 'molbrief-service-settings-'));
  const database = new LocalDatabase({ dataDir: directory });
  t.after(() => { database.close(); return rm(directory, { recursive: true, force: true }); });
  const environment = { SESSION_SECRET: '12'.repeat(32), ...additions };
  const store = new ServiceConfigStore({ database, environment, fetcher });
  return { directory, database, environment, store };
}
const llm = {
  LLM_BASE_URL: 'https://model.example.invalid/v1',
  LLM_MODEL: 'test-model', LLM_API_KEY: 'test-api-key-private-value',
};

test('new migration preserves existing articles and settings remain absent until saved', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'molbrief-settings-upgrade-'));
  const oldMigrations = path.join(directory, 'old-migrations');
  await mkdir(oldMigrations);
  await copyFile(new URL('../drizzle/0000_puzzling_ben_parker.sql', import.meta.url), path.join(oldMigrations, '0000_puzzling_ben_parker.sql'));
  const dataDir = path.join(directory, 'data');
  let database = new LocalDatabase({ dataDir, migrationsDir: oldMigrations });
  database.prepare('INSERT INTO articles(id,canonical_url,payload,collected_at) VALUES(?,?,?,?)')
    .bind('existing', 'https://example.invalid/paper', '{}', '2026-10-27').run();
  database.prepare('INSERT INTO reading_state(user_id,article_id,saved,read) VALUES(?,?,?,?)').bind('owner', 'existing', 1, 1).run();
  database.close();
  database = new LocalDatabase({ dataDir });
  t.after(() => { database.close(); return rm(directory, { recursive: true, force: true }); });
  const store = new ServiceConfigStore({ database, environment: { SESSION_SECRET: '12'.repeat(32) } });
  assert.deepEqual(database.appliedMigrations, ['0001_service_settings.sql', '0002_auto_collection.sql']);
  assert.equal(database.prepare("SELECT saved FROM reading_state WHERE article_id='existing'").first().saved, 1);
  assert.equal(store.settings().services.llm.status, 'unconfigured');
  assert.equal(database.prepare('SELECT count(*) AS n FROM service_settings').first().n, 0);
  store.save(llm);
  assert.equal(database.prepare('SELECT count(*) AS n FROM articles').first().n, 1);
  assert.equal(database.prepare('SELECT count(*) AS n FROM __molbrief_migrations').first().n, 3);
});

test('API keys are authenticated ciphertext and public settings never contain secret values', async t => {
  const { database, store, directory } = await fixture(t);
  const settings = store.save({ ...llm, PARALLEL_API_KEY: 'test-parallel-private-value' });
  assert.deepEqual(settings.fields.LLM_API_KEY, { present: true, source: 'database' });
  assert.equal(settings.fields.LLM_BASE_URL.value, llm.LLM_BASE_URL);
  const publicJson = JSON.stringify(settings);
  assert.ok(!publicJson.includes(llm.LLM_API_KEY));
  assert.ok(!publicJson.includes('test-parallel-private-value'));
  const row = database.prepare('SELECT encrypted_payload FROM service_settings').first();
  assert.match(row.encrypted_payload, /^v1\./);
  assert.ok(!row.encrypted_payload.includes(llm.LLM_API_KEY));
  assert.equal(store.runtime().LLM_API_KEY, llm.LLM_API_KEY);
  const oldCiphertext = row.encrypted_payload;
  store.save({ LLM_API_KEY: '' });
  assert.notEqual(database.prepare('SELECT encrypted_payload FROM service_settings').first().encrypted_payload, oldCiphertext);
  const snapshot = path.join(directory, 'private-test-snapshot.sqlite');
  database.snapshotTo(snapshot);
  const backup = await readFile(snapshot);
  assert.ok(!backup.includes(Buffer.from(llm.LLM_API_KEY)));
  assert.ok(!backup.includes(Buffer.from('test-parallel-private-value')));
});

test('environment fallback, blank-key retention and explicit clearing take effect immediately', async t => {
  const { store, environment } = await fixture(t, llm);
  assert.equal(store.runtime().LLM_API_KEY, llm.LLM_API_KEY);
  assert.equal(store.settings().fields.LLM_API_KEY.source, 'environment');
  assert.equal(store.settings().services.llm.status, 'configured');
  store.save({ LLM_API_KEY: '' });
  assert.equal(store.runtime().LLM_API_KEY, llm.LLM_API_KEY);
  store.save({ LLM_MODEL: 'new-test-model' });
  assert.equal(store.runtime().LLM_MODEL, 'new-test-model');
  environment.LLM_MODEL = 'changed-environment-model';
  assert.equal(store.runtime().LLM_MODEL, 'new-test-model');
  store.save({}, ['LLM_API_KEY']);
  assert.equal(store.runtime().LLM_API_KEY, '');
  assert.equal(store.settings().services.llm.status, 'unconfigured');
  assert.deepEqual(store.settings().fields.LLM_API_KEY, { present: false, source: 'database' });
  store.save({ LLM_API_KEY: 'replacement-test-key' });
  assert.equal(store.runtime().LLM_API_KEY, 'replacement-test-key');
});

test('configuration rejects unsupported fields, oversized strings and unsafe model API roots without partial writes', async t => {
  const { store, database } = await fixture(t);
  for (const values of [
    { SESSION_SECRET: 'injected' }, { LLM_API_KEY: 'line\nbreak' }, { LLM_MODEL: 'x'.repeat(161) },
    { LLM_BASE_URL: 'http://model.example.invalid/v1' },
    { LLM_BASE_URL: 'https://user:password@model.example.invalid/v1' },
    { LLM_BASE_URL: 'https://model.example.invalid/v1?token=hidden' },
    { LLM_BASE_URL: 'https://model.example.invalid/v1#fragment' },
    { LLM_BASE_URL: 'https://model.example.invalid/v1/chat/completions' },
    { LLM_API_KEY: 123 },
  ]) assert.throws(() => store.save(values), ServiceConfigError);
  assert.throws(() => store.save({}, ['SESSION_SECRET']), ServiceConfigError);
  assert.throws(() => store.save({ LLM_API_KEY: 'test-value' }, ['LLM_API_KEY']), ServiceConfigError);
  assert.equal(database.prepare('SELECT count(*) AS n FROM service_settings').first().n, 0);
});

test('changed encryption key or modified ciphertext fails closed with a safe recoverable message', async t => {
  const { database, environment, store } = await fixture(t);
  store.save(llm);
  environment.SESSION_SECRET = '34'.repeat(32);
  assert.throws(() => store.runtime(), error => error instanceof ServiceConfigError && error.status === 503 && !error.message.includes(llm.LLM_API_KEY));
  environment.SESSION_SECRET = '12'.repeat(32);
  const ciphertext = database.prepare('SELECT encrypted_payload FROM service_settings').first().encrypted_payload;
  const pieces = ciphertext.split('.');
  pieces[2] = (pieces[2][0] === 'A' ? 'B' : 'A') + pieces[2].slice(1);
  database.prepare('UPDATE service_settings SET encrypted_payload=?').bind(pieces.join('.')).run();
  assert.throws(() => store.settings(), ServiceConfigError);
});

test('one explicit mocked LLM verification validates JSON and persists only its matching configuration fingerprint', async t => {
  let calls = 0;
  const { store, environment, database } = await fixture(t, llm, async (url, options) => {
    calls++;
    assert.equal(url, llm.LLM_BASE_URL + '/chat/completions');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer ' + llm.LLM_API_KEY);
    const body = JSON.parse(options.body);
    assert.equal(body.max_tokens, 64);
    assert.equal(body.model, llm.LLM_MODEL);
    return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
  });
  const result = await store.verify('llm');
  assert.equal(calls, 1);
  assert.equal(result.verification.ok, true);
  assert.equal(result.services.llm.status, 'verified');
  assert.ok(!JSON.stringify(result).includes(llm.LLM_API_KEY));
  const reopened = new ServiceConfigStore({ database, environment });
  assert.equal(reopened.settings().services.llm.status, 'verified');
  environment.LLM_MODEL = 'changed-test-model';
  assert.equal(reopened.settings().services.llm.status, 'configured');
  assert.equal(reopened.settings().services.llm.verifiedAt, null);
  environment.LLM_MODEL = llm.LLM_MODEL;
  store.save({ LLM_MODEL: 'saved-model-change' });
  assert.equal(store.settings().services.llm.status, 'configured');
});

test('Parallel verification is one mocked minimal request; unrelated service changes keep a valid badge', async t => {
  let calls = 0;
  const { store } = await fixture(t, { PARALLEL_API_KEY: 'test-search-key' }, async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.parallel.ai/v1/search');
    assert.equal(options.headers['x-api-key'], 'test-search-key');
    assert.equal(JSON.parse(options.body).max_chars_total, 500);
    return Response.json({ results: [] });
  });
  assert.equal((await store.verify('parallel')).services.parallel.status, 'verified');
  store.save(llm);
  assert.equal(store.settings().services.parallel.status, 'verified');
  assert.equal(calls, 1);
});

test('missing configuration and unsupported standalone MiniMax verification never make a request', async t => {
  let calls = 0;
  const { store } = await fixture(t, {}, async () => { calls++; throw new Error('unexpected request'); });
  assert.equal((await store.verify('llm')).services.llm.status, 'unconfigured');
  assert.equal((await store.verify('parallel')).httpStatus, 400);
  store.save({ MINIMAX_API_KEY: 'test-voice-key', MINIMAX_VOICE_ID: 'test-voice' });
  const voice = await store.verify('tts');
  assert.equal(voice.services.tts.status, 'configured');
  assert.equal(voice.services.tts.verificationSupported, false);
  assert.equal(voice.verification.ok, false);
  assert.equal(calls, 0);
});

test('provider errors and incompatible JSON never expose raw responses, keys or false verification', async t => {
  let succeed = true;
  const { store } = await fixture(t, llm, async () => succeed
    ? Response.json({ choices: [{ message: { content: '{"ok":true}' } }] })
    : Response.json({ error: 'debug echo ' + llm.LLM_API_KEY }, { status: 401 }));
  assert.equal((await store.verify('llm')).services.llm.status, 'verified');
  succeed = false;
  const failed = await store.verify('llm');
  assert.equal(failed.services.llm.status, 'configured');
  assert.equal(failed.verification.ok, false);
  assert.equal(failed.httpStatus, 502);
  assert.ok(!JSON.stringify(failed).includes(llm.LLM_API_KEY));
  assert.ok(!JSON.stringify(failed).includes('debug echo'));
  store.fetcher = async () => Response.json({ choices: [{ message: { content: 'not json' } }] });
  assert.equal((await store.verify('llm')).verification.ok, false);
});

test('configuration changed during a verification request cannot acquire the previous configuration badge', async t => {
  const { store } = await fixture(t, llm);
  store.fetcher = async () => {
    store.save({ LLM_MODEL: 'newer-model' });
    return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
  };
  const result = await store.verify('llm');
  assert.equal(result.verification.ok, false);
  assert.equal(result.httpStatus, 409);
  assert.equal(result.services.llm.status, 'configured');
});
