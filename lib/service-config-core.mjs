import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

const SECRET_FIELDS = new Set(['PARALLEL_API_KEY', 'LLM_API_KEY', 'MINIMAX_API_KEY']);
const FIELD_LIMITS = {
  PARALLEL_API_KEY: 1024, LLM_BASE_URL: 1024, LLM_API_KEY: 1024, LLM_MODEL: 160,
  MINIMAX_API_KEY: 1024, MINIMAX_VOICE_ID: 160, MINIMAX_MODEL: 160,
};
const SERVICES = {
  parallel: ['PARALLEL_API_KEY'],
  llm: ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL'],
  tts: ['MINIMAX_API_KEY', 'MINIMAX_VOICE_ID', 'MINIMAX_MODEL'],
};
const DEFAULTS = { MINIMAX_MODEL: 'speech-2.8-turbo' };
const CONTEXT = 'molbrief:service-settings:owner:v1';

export class ServiceConfigError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'ServiceConfigError'; this.status = status; }
}

function encryptionKey(secret) {
  if (typeof secret !== 'string' || !/^[0-9a-f]{64,128}$/i.test(secret) || secret.length % 2) {
    throw new ServiceConfigError('服务配置加密密钥不可用，请检查服务器的 SESSION_SECRET。', 503);
  }
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'hex'), 'molbrief-service-config', CONTEXT, 32));
}

function seal(payload, secret) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), nonce);
  cipher.setAAD(Buffer.from(CONTEXT));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return ['v1', nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

function unseal(value, secret) {
  try {
    const [version, nonce, tag, encrypted, extra] = value.split('.');
    if (version !== 'v1' || extra !== undefined || !nonce || !tag || !encrypted) throw new Error();
    const nonceBytes = Buffer.from(nonce, 'base64url'), tagBytes = Buffer.from(tag, 'base64url');
    if (nonceBytes.length !== 12 || tagBytes.length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), nonceBytes);
    decipher.setAAD(Buffer.from(CONTEXT));
    decipher.setAuthTag(tagBytes);
    const raw = Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]);
    const payload = JSON.parse(raw.toString('utf8'));
    if (payload.version !== 1 || !payload.overrides || typeof payload.overrides !== 'object' || Array.isArray(payload.overrides)) throw new Error();
    if (!payload.verified || typeof payload.verified !== 'object' || Array.isArray(payload.verified)) throw new Error();
    for (const [name, setting] of Object.entries(payload.overrides)) {
      if (!(name in FIELD_LIMITS) || typeof setting !== 'string' || setting.length > FIELD_LIMITS[name]) throw new Error();
    }
    return payload;
  } catch {
    throw new ServiceConfigError('已保存的服务配置无法解密。恢复配置需要原来的 SESSION_SECRET，请保留服务器私密配置备份。', 503);
  }
}

function normalizeField(name, input) {
  if (typeof input !== 'string' || input.length > FIELD_LIMITS[name]) throw new ServiceConfigError('服务配置格式不正确或内容过长。');
  const value = input.trim();
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new ServiceConfigError('服务配置不能包含控制字符。');
  if (!value) return '';
  if (SECRET_FIELDS.has(name) && !/^[\x21-\x7e]+$/.test(value)) throw new ServiceConfigError('API 密钥不能包含空格或非英文字符。');
  if (name === 'LLM_BASE_URL') {
    let url;
    try { url = new URL(value); } catch { throw new ServiceConfigError('模型 API 地址格式不正确。'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || /\/chat\/completions\/?$/i.test(url.pathname)) {
      throw new ServiceConfigError('模型地址需为 HTTPS API 根路径，不能包含账号、查询参数或 /chat/completions。');
    }
    return url.href.replace(/\/$/, '');
  }
  return value;
}

async function limitedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('empty response');
  const decoder = new TextDecoder();
  let raw = '', bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 65536) { await reader.cancel(); throw new Error('response too large'); }
      raw += decoder.decode(part.value, { stream: true });
    }
    raw += decoder.decode();
  } finally { reader.releaseLock(); }
  return JSON.parse(raw);
}

/** Only constructed on the server. All mutable settings are read afresh for each request. */
export class ServiceConfigStore {
  constructor({ database, environment = process.env, fetcher = globalThis.fetch }) {
    this.database = database;
    this.environment = environment;
    this.fetcher = fetcher;
  }

  load() {
    const row = this.database.prepare("SELECT encrypted_payload FROM service_settings WHERE user_id='owner'").first();
    return row ? unseal(row.encrypted_payload, this.environment.SESSION_SECRET) : { version: 1, overrides: {}, verified: {} };
  }

  persist(payload) {
    const encrypted = seal(payload, this.environment.SESSION_SECRET);
    this.database.prepare("INSERT INTO service_settings(user_id,encrypted_payload,updated_at) VALUES('owner',?,?) ON CONFLICT(user_id) DO UPDATE SET encrypted_payload=excluded.encrypted_payload,updated_at=excluded.updated_at")
      .bind(encrypted, new Date().toISOString()).run();
  }

  effective(payload = this.load()) {
    return Object.fromEntries(Object.keys(FIELD_LIMITS).map(name => [name,
      Object.hasOwn(payload.overrides, name) ? payload.overrides[name] : (this.environment[name] || DEFAULTS[name] || ''),
    ]));
  }

  fingerprint(service, effective) {
    return createHmac('sha256', encryptionKey(this.environment.SESSION_SECRET))
      .update(JSON.stringify([service, ...SERVICES[service].map(name => effective[name])])).digest('hex');
  }

  runtime() { return this.effective(); }

  settings() {
    const payload = this.load(), effective = this.effective(payload);
    const fields = Object.fromEntries(Object.keys(FIELD_LIMITS).map(name => {
      const source = Object.hasOwn(payload.overrides, name) ? 'database' : this.environment[name] ? 'environment' : DEFAULTS[name] ? 'default' : 'empty';
      return [name, SECRET_FIELDS.has(name) ? { present: !!effective[name], source } : { value: effective[name], present: !!effective[name], source }];
    }));
    const services = Object.fromEntries(Object.entries(SERVICES).map(([service, required]) => {
      const configured = required.every(name => !!effective[name]);
      const record = payload.verified[service];
      const verified = configured && record && typeof record.verifiedAt === 'string' && record.fingerprint === this.fingerprint(service, effective);
      return [service, {
        status: !configured ? 'unconfigured' : verified ? 'verified' : 'configured',
        verifiedAt: verified ? record.verifiedAt : null,
        verificationSupported: service !== 'tts',
      }];
    }));
    return { fields, services, encryption: 'session-secret' };
  }

  save(values = {}, clear = []) {
    if (!values || typeof values !== 'object' || Array.isArray(values) || !Array.isArray(clear) || clear.length > Object.keys(FIELD_LIMITS).length) {
      throw new ServiceConfigError('服务配置格式不正确。');
    }
    if (Object.keys(values).some(name => !Object.hasOwn(FIELD_LIMITS, name)) || clear.some(name => typeof name !== 'string' || !Object.hasOwn(FIELD_LIMITS, name))) {
      throw new ServiceConfigError('包含不支持的服务配置项。');
    }
    const patch = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, normalizeField(name, value)]));
    if (clear.some(name => Object.hasOwn(patch, name) && patch[name])) throw new ServiceConfigError('同一配置项不能同时填写和清除。');
    const payload = this.load(), before = this.effective(payload);
    for (const [name, value] of Object.entries(patch)) {
      if (!SECRET_FIELDS.has(name) || value) payload.overrides[name] = value;
    }
    for (const name of clear) payload.overrides[name] = '';
    const after = this.effective(payload);
    for (const [service, names] of Object.entries(SERVICES)) {
      if (names.some(name => before[name] !== after[name])) delete payload.verified[service];
    }
    this.persist(payload);
    return this.settings();
  }

  async verify(service) {
    if (!Object.hasOwn(SERVICES, service)) throw new ServiceConfigError('请选择支持的服务。');
    let payload = this.load();
    const effective = this.effective(payload);
    const result = (ok, message, status = 200) => ({ ...this.settings(), verification: { service, ok, message }, ...(ok ? {} : { error: message }), httpStatus: status });
    if (!SERVICES[service].every(name => !!effective[name])) return result(false, '请先保存完整的服务配置，再进行验证。', 400);
    if (service === 'tts') return result(false, 'MiniMax 暂不提供单独的连接验证，请在实际生成音频后验收声音与音色。', 400);
    const fingerprint = this.fingerprint(service, effective);
    // A failed retest must not preserve an earlier success badge.
    delete payload.verified[service];
    this.persist(payload);
    let status = 0;
    try {
      let url, headers, body;
      if (service === 'llm') {
        const base = normalizeField('LLM_BASE_URL', effective.LLM_BASE_URL);
        url = base + '/chat/completions';
        headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + effective.LLM_API_KEY };
        body = { model: effective.LLM_MODEL, messages: [{ role: 'user', content: '连接测试。请仅输出 JSON：{"ok":true}' }], response_format: { type: 'json_object' }, max_tokens: 64 };
      } else {
        url = 'https://api.parallel.ai/v1/search';
        headers = { 'Content-Type': 'application/json', 'x-api-key': effective.PARALLEL_API_KEY };
        body = { search_queries: ['PubMed biomedical literature database'], mode: 'fast', max_chars_total: 500 };
      }
      // Exactly one explicit test request; no retries and no credential-bearing redirects.
      const response = await this.fetcher(url, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(30000) });
      status = response.status;
      if (!response.ok) throw new Error('provider rejected request');
      const data = await limitedJson(response);
      if (service === 'llm') {
        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || JSON.parse(content).ok !== true) throw new Error('incompatible model response');
      } else if (!Array.isArray(data.results)) throw new Error('incompatible search response');
      payload = this.load();
      if (this.fingerprint(service, this.effective(payload)) !== fingerprint) return result(false, '验证期间配置已修改，请使用当前配置重新验证。', 409);
      payload.verified[service] = { fingerprint, verifiedAt: new Date().toISOString() };
      this.persist(payload);
      return result(true, '一次真实请求已通过验证。后续调用仍受服务额度、网络与模型兼容性影响。');
    } catch {
      const message = [401, 403].includes(status) ? '服务拒绝访问，请检查 API 密钥和权限。'
        : status === 429 ? '服务返回额度或频率限制，请检查账号余额与调用限制。'
          : status && status !== 200 ? `服务请求未通过（HTTP ${status}），请检查配置后重试。`
            : '服务验证未通过，请检查网络、API 地址、模型及 JSON 响应兼容性。';
      return result(false, message, 502);
    }
  }
}
