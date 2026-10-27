import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "molbrief_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export type User = {
  userId: "owner";
  displayName: string;
  email: string;
  fullName: string | null;
};
export type AuthConfig = {
  username: string;
  passwordHash: string;
  sessionSecret: string;
  appOrigin: string;
  secureCookie: boolean;
  ingestToken: string | null;
};

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

/** No authentication defaults: incomplete or malformed configuration stays closed. */
export function readAuthConfig(values: Record<string, string | undefined> = process.env): AuthConfig | null {
  const username = values.ADMIN_USERNAME?.trim() || "";
  const passwordHash = values.ADMIN_PASSWORD_HASH || "";
  const sessionSecret = values.SESSION_SECRET || "";
  if (!/^[A-Za-z0-9._@-]{3,80}$/.test(username)) return null;
  if (!/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/i.test(passwordHash)) return null;
  if (!/^[a-f0-9]{64,128}$/i.test(sessionSecret) || sessionSecret.length % 2 !== 0) return null;
  let origin: URL;
  try { origin = new URL(values.APP_ORIGIN || ""); } catch { return null; }
  if (!/^https?:$/.test(origin.protocol) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") return null;
  const serviceToken = values.INGEST_API_TOKEN || "";
  return {
    username, passwordHash, sessionSecret,
    appOrigin: origin.origin,
    secureCookie: origin.protocol === "https:",
    ingestToken: /^[a-f0-9]{64,128}$/i.test(serviceToken) && serviceToken.length % 2 === 0 ? serviceToken : null,
  };
}

function credentialTag(config: AuthConfig) {
  return createHash("sha256").update(config.username + "\n" + config.passwordHash).digest("hex");
}

function signature(value: string, config: AuthConfig) {
  return createHmac("sha256", Buffer.from(config.sessionSecret, "hex")).update(value).digest();
}

export function createSession(config: AuthConfig, now = Date.now()): string {
  const issued = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({
    v: 1, sub: "owner", iat: issued, exp: issued + SESSION_TTL_SECONDS,
    credential: credentialTag(config), nonce: randomBytes(16).toString("hex"),
  })).toString("base64url");
  return payload + "." + signature(payload, config).toString("base64url");
}

export function verifySession(token: string | null | undefined, config: AuthConfig, now = Date.now()): User | null {
  if (!token || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null;
  try {
    const expected = signature(parts[0], config);
    const actual = Buffer.from(parts[1], "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const seconds = Math.floor(now / 1000);
    if (payload.v !== 1 || payload.sub !== "owner" || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)) return null;
    if (payload.iat > seconds + 60 || payload.exp <= seconds || payload.exp - payload.iat !== SESSION_TTL_SECONDS) return null;
    if (payload.credential !== credentialTag(config)) return null;
    return { userId: "owner", displayName: config.username, email: "", fullName: null };
  } catch { return null; }
}

/** Only an application cookie authenticates a visitor; platform/proxy identity headers do not. */
export function userFromRequest(request: Request, config: AuthConfig): User | null {
  const cookie = request.headers.get("cookie") || "";
  const item = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(SESSION_COOKIE + "="));
  return verifySession(item?.slice(SESSION_COOKIE.length + 1), config);
}

export function serviceTokenMatches(request: Request, config: AuthConfig): boolean {
  if (!config.ingestToken) return false;
  const authorization = request.headers.get("authorization") || "";
  const match = /^Bearer ([a-f0-9]{64,128})$/i.exec(authorization);
  if (!match) return false;
  const actual = Buffer.from(match[1], "utf8");
  const expected = Buffer.from(config.ingestToken, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function enforceSameOrigin(request: Request, config: AuthConfig): void {
  const origin = request.headers.get("origin");
  if (origin && origin !== config.appOrigin) throw new AuthError("请求来源不匹配，请从配置的网站地址重新打开。", 403);
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new AuthError("不接受跨站操作。", 403);
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (password.length < 1 || password.length > 512 || !/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/i.test(storedHash)) return false;
  const [, salt, encodedKey] = storedHash.split(":");
  const key = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, Buffer.from(salt, "hex"), 64, SCRYPT_OPTIONS, (error, result) => {
      if (error) reject(error); else resolve(result);
    });
  });
  return timingSafeEqual(key, Buffer.from(encodedKey, "hex"));
}

export function sessionCookieOptions(config: AuthConfig) {
  return { httpOnly: true, sameSite: "lax" as const, secure: config.secureCookie, path: "/", maxAge: SESSION_TTL_SECONDS };
}

type Attempts = { count: number; resetAt: number };
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;
// One single-owner server has one shared login budget. It does not trust X-Forwarded-For.
const processState = globalThis as typeof globalThis & { __molbriefLoginAttempts?: Attempts };
export function consumeLoginAttempt(now = Date.now()): number {
  let state = processState.__molbriefLoginAttempts;
  if (!state || now >= state.resetAt) state = processState.__molbriefLoginAttempts = { count: 0, resetAt: now + WINDOW_MS };
  if (state.count >= MAX_ATTEMPTS) return Math.max(1, Math.ceil((state.resetAt - now) / 1000));
  state.count += 1;
  return 0;
}
export function clearLoginAttempts(): void { delete processState.__molbriefLoginAttempts; }
