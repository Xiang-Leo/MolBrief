import test from "node:test";
import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import {
  readAuthConfig, createSession, verifySession, verifyPassword, userFromRequest,
  serviceTokenMatches, enforceSameOrigin, SESSION_COOKIE, SESSION_TTL_SECONDS,
  clearLoginAttempts, consumeLoginAttempt,
} from "../lib/auth-core.ts";

// Disposable test-only credentials. No production or third-party secrets are used.
const password = "test-password-only-for-auth-suite";
const salt = Buffer.alloc(16, 7);
const hash = "scrypt:" + salt.toString("hex") + ":" + scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("hex");
const values = {
  ADMIN_USERNAME: "test-owner", ADMIN_PASSWORD_HASH: hash,
  SESSION_SECRET: "ab".repeat(32), INGEST_API_TOKEN: "cd".repeat(32), APP_ORIGIN: "https://molbrief.example",
};
const config = readAuthConfig(values);
const now = Date.UTC(2026, 9, 27, 0, 0, 0);

test("configuration fails closed without valid credentials and origin", () => {
  assert.equal(readAuthConfig({}), null);
  assert.equal(readAuthConfig({ ...values, SESSION_SECRET: "change-me" }), null);
  assert.equal(readAuthConfig({ ...values, APP_ORIGIN: "https://other.example/path" }), null);
  assert.equal(config.secureCookie, true);
  assert.equal(readAuthConfig({ ...values, APP_ORIGIN: "http://localhost:3000" }).secureCookie, false);
});

test("sessions reject payload tampering, bad signatures, expiry and changed passwords", () => {
  const token = createSession(config, now);
  assert.equal(verifySession(token, config, now).userId, "owner");
  const [payload, signature] = token.split(".");
  const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url")), exp: 9999999999 })).toString("base64url");
  assert.equal(verifySession(changed + "." + signature, config, now), null);
  assert.equal(verifySession(payload + "." + "x".repeat(43), config, now), null);
  assert.equal(verifySession(token, config, now + SESSION_TTL_SECONDS * 1000), null);
  assert.equal(verifySession(token, { ...config, passwordHash: hash.replace(/^scrypt:./, "scrypt:f") }, now), null);
  assert.equal(verifySession(token, { ...config, sessionSecret: "ef".repeat(32) }, now), null);
});

test("identity headers and service tokens never become a visitor identity", () => {
  const fake = new Request("https://molbrief.example/api/state", { headers: {
    "oai-authenticated-user-id": "owner", "oai-authenticated-user-email": "owner@example.test",
    authorization: "Bearer " + config.ingestToken,
  } });
  assert.equal(userFromRequest(fake, config), null);
  assert.equal(serviceTokenMatches(fake, config), true);
  const session = createSession(config);
  const visitor = new Request("https://molbrief.example/api/state", { headers: { cookie: `${SESSION_COOKIE}=${session}` } });
  assert.equal(userFromRequest(visitor, config).userId, "owner");
  assert.equal(serviceTokenMatches(visitor, config), false);
  assert.equal(serviceTokenMatches(new Request("https://molbrief.example", { headers: { authorization: "Bearer wrong" } }), config), false);
});

test("same-origin mutations allow CLI requests and reject other origins", () => {
  assert.doesNotThrow(() => enforceSameOrigin(new Request("https://molbrief.example/api/ingest"), config));
  assert.doesNotThrow(() => enforceSameOrigin(new Request("https://molbrief.example/api/reading", { headers: { origin: config.appOrigin } }), config));
  assert.throws(() => enforceSameOrigin(new Request("https://molbrief.example/api/reading", { headers: { origin: "https://attacker.example" } }), config), { status: 403 });
  assert.throws(() => enforceSameOrigin(new Request("https://molbrief.example/api/reading", { headers: { "sec-fetch-site": "cross-site" } }), config), { status: 403 });
});

test("scrypt password check accepts only the configured password", async () => {
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword("another-password", hash), false);
  assert.equal(await verifyPassword(password, "invalid-hash"), false);
});

test("login attempt budget is bounded without trusting forwarded IP headers", () => {
  clearLoginAttempts();
  for (let i = 0; i < 10; i++) assert.equal(consumeLoginAttempt(now), 0);
  assert.ok(consumeLoginAttempt(now) > 0);
  assert.equal(consumeLoginAttempt(now + 10 * 60 * 1000), 0);
  clearLoginAttempts();
});
