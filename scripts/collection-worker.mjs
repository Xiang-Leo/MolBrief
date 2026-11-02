import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_TARGET = 'http://app:3000/api/collection/tick';
const TICK_PATH = '/api/collection/tick';
const MAX_TIMEOUT_MS = 12 * 60 * 1000;

export class WorkerConfigError extends Error {
  constructor(field) { super(`Invalid worker configuration: ${field}.`); this.name = 'WorkerConfigError'; }
}

/** Credentials may only reach the Compose app service or an explicit loopback test server. */
export function validateWorkerTarget(value = DEFAULT_TARGET) {
  let url;
  try { url = new URL(value); } catch { throw new WorkerConfigError('COLLECTION_API_URL'); }
  const authority = /^https?:\/\/([^/]+)/i.exec(value)?.[1] || '';
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const composeApp = url.hostname === 'app' && url.protocol === 'http:' && url.port === '3000';
  if (!['http:', 'https:'].includes(url.protocol) || (!loopback && !composeApp)
    || url.username || url.password || authority.includes('@') || url.search || url.hash || url.pathname !== TICK_PATH) {
    throw new WorkerConfigError('COLLECTION_API_URL');
  }
  return url.href;
}

function validateOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new WorkerConfigError('APP_ORIGIN'); }
  const authority = /^https?:\/\/([^/]+)/i.exec(value)?.[1] || '';
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || authority.includes('@')
    || url.pathname !== '/' || url.search || url.hash) throw new WorkerConfigError('APP_ORIGIN');
  return url.origin;
}

function validateToken(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64,128}$/i.test(value) || value.length % 2 !== 0) {
    throw new WorkerConfigError('INGEST_API_TOKEN');
  }
  return value;
}

function integerSetting(value, fallback, minimum, maximum, field) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw new WorkerConfigError(field);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new WorkerConfigError(field);
  return number;
}

export function readWorkerConfig(environment = process.env) {
  return Object.freeze({
    url: validateWorkerTarget(environment.COLLECTION_API_URL || DEFAULT_TARGET),
    origin: validateOrigin(environment.APP_ORIGIN),
    token: validateToken(environment.INGEST_API_TOKEN),
    intervalMs: integerSetting(environment.COLLECTION_TICK_INTERVAL_SECONDS, 60, 5, 86400, 'COLLECTION_TICK_INTERVAL_SECONDS') * 1000,
    timeoutMs: integerSetting(environment.COLLECTION_REQUEST_TIMEOUT_MS, MAX_TIMEOUT_MS, 1000, MAX_TIMEOUT_MS, 'COLLECTION_REQUEST_TIMEOUT_MS'),
  });
}

export function abortableDelay(milliseconds, signal) {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise(resolveDelay => {
    const finish = elapsed => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      resolveDelay(elapsed);
    };
    const aborted = () => finish(false);
    const timer = setTimeout(() => finish(true), milliseconds);
    signal?.addEventListener('abort', aborted, { once: true });
  });
}

/** One request, no redirects, retries, response parsing, database access or external service calls. */
export async function tickOnce(config, { fetcher = globalThis.fetch, signal } = {}) {
  // Validate again at the credential boundary, including when this function is imported directly.
  const url = validateWorkerTarget(config.url);
  const origin = validateOrigin(config.origin), token = validateToken(config.token);
  if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > MAX_TIMEOUT_MS) {
    throw new WorkerConfigError('COLLECTION_REQUEST_TIMEOUT_MS');
  }
  if (signal?.aborted) return { ok: false, status: null, error: 'cancelled' };
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), config.timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  try {
    const response = await fetcher(url, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, Origin: origin, 'Content-Type': 'application/json' },
      body: '{}', redirect: 'error', cache: 'no-store', signal: requestSignal,
    });
    // Status is the only response information the worker needs. A provider error
    // echoed through the app must never be read into worker output.
    try { await response.body?.cancel(); } catch {}
    return { ok: response.ok, status: response.status, error: response.ok ? null : 'http' };
  } catch {
    return { ok: false, status: null, error: signal?.aborted ? 'cancelled' : timeout.signal.aborted ? 'timeout' : 'network' };
  } finally { clearTimeout(timer); }
}

function safeResultLine(result) {
  if (Number.isInteger(result.status)) return `collection worker tick HTTP ${result.status}`;
  return `collection worker tick ${result.error === 'timeout' ? 'timed out' : result.error === 'cancelled' ? 'cancelled' : 'network request failed'}`;
}

/** Each tick settles before the next interval begins, so this process cannot overlap requests. */
export async function runWorker(config, { once = false, fetcher = globalThis.fetch, signal, log = console.log, wait = abortableDelay } = {}) {
  while (!signal?.aborted) {
    const result = await tickOnce(config, { fetcher, signal });
    log(safeResultLine(result));
    if (once) return result.ok || signal?.aborted ? 0 : 1;
    if (signal?.aborted) break;
    await wait(config.intervalMs, signal);
  }
  return 0;
}

export async function main(argv = process.argv.slice(2), environment = process.env) {
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    if (argv.some(argument => argument !== '--once') || argv.length > 1) throw new WorkerConfigError('arguments');
    return await runWorker(readWorkerConfig(environment), { once: argv.includes('--once'), signal: shutdown.signal });
  } catch (error) {
    console.error(error instanceof WorkerConfigError ? error.message : 'Collection worker failed.');
    return 1;
  } finally {
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
