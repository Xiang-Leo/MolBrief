import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  abortableDelay, readWorkerConfig, runWorker, tickOnce, validateWorkerTarget, WorkerConfigError,
} from '../scripts/collection-worker.mjs';

const token = 'ab'.repeat(32); // Disposable test-only token, never a real server credential.
const environment = { APP_ORIGIN: 'https://molbrief.example.invalid', INGEST_API_TOKEN: token };
const config = () => readWorkerConfig(environment);
const script = fileURLToPath(new URL('../scripts/collection-worker.mjs', import.meta.url));

async function localServer(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return { server, url: `http://127.0.0.1:${server.address().port}/api/collection/tick` };
}
function childWorker(url, extra = {}) {
  const child = spawn(process.execPath, [script, '--once'], {
    env: { ...process.env, ...environment, COLLECTION_API_URL: url, ...extra }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => output += chunk);
  child.stderr.on('data', chunk => output += chunk);
  const completion = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal, output })));
  return { child, completion };
}

test('worker defaults to the Compose app and enforces bounded interval and timeout', () => {
  assert.equal(config().url, 'http://app:3000/api/collection/tick');
  assert.equal(config().intervalMs, 60000); assert.equal(config().timeoutMs, 720000);
  assert.equal(readWorkerConfig({ ...environment, COLLECTION_TICK_INTERVAL_SECONDS: '5' }).intervalMs, 5000);
  for (const extra of [
    { INGEST_API_TOKEN: '' }, { INGEST_API_TOKEN: 'not-a-token' }, { APP_ORIGIN: 'https://user:secret@example.invalid' },
    { COLLECTION_TICK_INTERVAL_SECONDS: '4' }, { COLLECTION_TICK_INTERVAL_SECONDS: 'NaN' },
    { COLLECTION_REQUEST_TIMEOUT_MS: '720001' }, { COLLECTION_REQUEST_TIMEOUT_MS: '-1' },
  ]) assert.throws(() => readWorkerConfig({ ...environment, ...extra }), WorkerConfigError);
});

test('worker target rejects external hosts, credentials, alternate endpoints and token-bearing URLs', async () => {
  const unsafe = [
    'https://public.example.invalid/api/collection/tick', 'http://app.example.invalid:3000/api/collection/tick',
    'http://user:password@app:3000/api/collection/tick', 'http://@app:3000/api/collection/tick',
    'http://app:3000/api/ingest', 'http://app:3000/api/collection/tick?token=private',
    'http://app:3000/api/collection/tick#private', 'ftp://app:3000/api/collection/tick',
    'http://app:8080/api/collection/tick', 'http://169.254.169.254/api/collection/tick',
  ];
  let calls = 0;
  for (const url of unsafe) {
    assert.throws(() => validateWorkerTarget(url), WorkerConfigError);
    await assert.rejects(tickOnce({ ...config(), url }, { fetcher: async () => { calls++; } }), WorkerConfigError);
  }
  assert.equal(calls, 0);
  assert.equal(validateWorkerTarget('http://127.0.0.1:12345/api/collection/tick'), 'http://127.0.0.1:12345/api/collection/tick');
  assert.equal(validateWorkerTarget('http://[::1]:12345/api/collection/tick'), 'http://[::1]:12345/api/collection/tick');
});

test('tick sends only the internal POST with owner origin and service authorization and never reads response content', async () => {
  let calls = 0, consumed = false;
  const result = await tickOnce(config(), { fetcher: async (url, options) => {
    calls++;
    assert.equal(url, 'http://app:3000/api/collection/tick');
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer ' + token);
    assert.equal(options.headers.Origin, environment.APP_ORIGIN);
    assert.equal(options.body, '{}'); assert.ok(options.signal instanceof AbortSignal);
    return { ok: true, status: 200, body: { cancel: async () => {} }, json() { consumed = true; throw new Error('must not read'); }, text() { consumed = true; throw new Error('must not read'); } };
  } });
  assert.deepEqual(result, { ok: true, status: 200, error: null });
  assert.equal(calls, 1); assert.equal(consumed, false);
});

test('loop waits for each fetch to settle before starting another tick', async () => {
  const shutdown = new AbortController(), lines = [];
  let active = 0, maxActive = 0, calls = 0, waits = 0;
  const exit = await runWorker(config(), {
    signal: shutdown.signal, log: line => lines.push(line),
    fetcher: async () => {
      active++; calls++; maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return new Response('{}', { status: 200 });
    },
    wait: async () => { assert.equal(active, 0); waits++; if (calls === 3) shutdown.abort(); },
  });
  assert.equal(exit, 0); assert.equal(calls, 3); assert.equal(waits, 3); assert.equal(maxActive, 1);
  assert.ok(lines.every(line => line === 'collection worker tick HTTP 200'));
});

test('timeout and shutdown abort in-flight requests; already-stopped workers never fetch', async () => {
  const pendingFetch = async (_url, options) => new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('private request details')), { once: true });
  });
  const timedOut = await tickOnce({ ...config(), timeoutMs: 15 }, { fetcher: pendingFetch });
  assert.deepEqual(timedOut, { ok: false, status: null, error: 'timeout' });
  const shutdown = new AbortController();
  const running = tickOnce(config(), { signal: shutdown.signal, fetcher: pendingFetch });
  shutdown.abort();
  assert.deepEqual(await running, { ok: false, status: null, error: 'cancelled' });
  let calls = 0;
  await runWorker(config(), { signal: shutdown.signal, fetcher: async () => { calls++; }, log() {} });
  assert.equal(calls, 0);
  assert.equal(await abortableDelay(60000, shutdown.signal), false);
});

test('failure logging contains only safe status or fixed network errors and --once returns nonzero', async () => {
  const lines = [];
  const failedHttp = await runWorker(config(), { once: true, log: line => lines.push(line), fetcher: async () => new Response('provider echo ' + token, { status: 500 }) });
  const failedNetwork = await runWorker(config(), { once: true, log: line => lines.push(line), fetcher: async () => { throw new Error('Authorization: Bearer ' + token); } });
  assert.equal(failedHttp, 1); assert.equal(failedNetwork, 1);
  assert.deepEqual(lines, ['collection worker tick HTTP 500', 'collection worker tick network request failed']);
  assert.ok(!lines.join(' ').includes(token));
});

test('CLI --once exits successfully for HTTP 200 and nonzero for HTTP failures without revealing body or token', async t => {
  let status = 200, calls = 0;
  const { url } = await localServer(t, (request, response) => {
    calls++;
    assert.equal(request.method, 'POST'); assert.equal(request.headers.authorization, 'Bearer ' + token);
    assert.equal(request.headers.origin, environment.APP_ORIGIN);
    response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ secret: token }));
  });
  const succeeded = await childWorker(url).completion;
  assert.equal(succeeded.code, 0); assert.equal(succeeded.signal, null);
  status = 503;
  const failed = await childWorker(url).completion;
  assert.equal(failed.code, 1); assert.equal(calls, 2);
  for (const result of [succeeded, failed]) { assert.ok(!result.output.includes(token)); assert.ok(!result.output.includes('secret')); }
});

test('CLI refuses credential-bearing external targets before sending and SIGTERM cancels a pending --once', async t => {
  const invalid = await childWorker('https://user:do-not-log@example.invalid/api/collection/tick').completion;
  assert.equal(invalid.code, 1); assert.ok(!invalid.output.includes('do-not-log')); assert.ok(!invalid.output.includes(token));
  let received;
  const started = new Promise(resolve => { received = resolve; });
  const { url } = await localServer(t, () => received());
  const { child, completion } = childWorker(url);
  await started;
  child.kill('SIGTERM');
  const result = await completion;
  assert.equal(result.code, 0); assert.equal(result.signal, null);
  assert.ok(result.output.includes('cancelled')); assert.ok(!result.output.includes(token));
});
