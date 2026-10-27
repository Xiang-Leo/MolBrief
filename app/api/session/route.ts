import { NextResponse } from "next/server";
import {
  AuthError, clearLoginAttempts, consumeLoginAttempt, createSession, enforceSameOrigin,
  readAuthConfig, SESSION_COOKIE, sessionCookieOptions, verifyPassword,
} from "@/lib/auth-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function parseInput(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") || 0) > 8192) throw new AuthError("登录信息过长。", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError("请填写账号和密码。",400);
  let raw = "", size = 0;
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 8192) { await reader.cancel(); throw new AuthError("登录信息过长。",413); }
      raw += decoder.decode(part.value,{stream:true});
    }
    raw += decoder.decode();
  } finally { reader.releaseLock(); }
  if (request.headers.get("content-type")?.includes("application/json")) {
    let data: unknown;
    try { data = JSON.parse(raw); } catch { throw new AuthError("登录信息格式不正确。", 400); }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new AuthError("登录信息格式不正确。", 400);
    return data as Record<string, unknown>;
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

export async function POST(request: Request) {
  const json = request.headers.get("content-type")?.includes("application/json") || false;
  const config = readAuthConfig();
  if (!config) return NextResponse.json({ error: "站点尚未完成账号配置，请在服务器运行 node scripts/setup.mjs。" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  try {
    enforceSameOrigin(request, config);
    const input = await parseInput(request);
    if (input.action === "logout") return logout(config, json);
    const retryAfter = consumeLoginAttempt();
    if (retryAfter) {
      if (json) return NextResponse.json({ error: "尝试次数较多，请稍后再试。" }, { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } });
      return NextResponse.redirect(new URL("/login?error=cooldown", config.appOrigin), 303);
    }
    const username = typeof input.username === "string" ? input.username.trim() : "";
    const password = typeof input.password === "string" ? input.password : "";
    // Always derive the password key, including when the username is wrong.
    const validPassword = await verifyPassword(password, config.passwordHash);
    if (username !== config.username || !validPassword) {
      if (json) return NextResponse.json({ error: "账号或密码不正确。" }, { status: 401, headers: { "Cache-Control": "no-store" } });
      return NextResponse.redirect(new URL("/login?error=credentials", config.appOrigin), 303);
    }
    clearLoginAttempts();
    const response = json ? NextResponse.json({ ok: true }) : NextResponse.redirect(new URL("/", config.appOrigin), 303);
    response.headers.set("Cache-Control", "no-store");
    response.cookies.set(SESSION_COOKIE, createSession(config), sessionCookieOptions(config));
    return response;
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 500;
    const message = error instanceof AuthError ? error.message : "登录暂未完成，请稍后重试。";
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

function logout(config: NonNullable<ReturnType<typeof readAuthConfig>>, json: boolean) {
  const response = json ? NextResponse.json({ ok: true }) : NextResponse.redirect(new URL("/login", config.appOrigin), 303);
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(config), maxAge: 0 });
  return response;
}

export async function DELETE(request: Request) {
  const config = readAuthConfig();
  if (!config) return NextResponse.json({ error: "站点账号配置未完成。" }, { status: 503 });
  try { enforceSameOrigin(request, config); return logout(config, true); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "请求未完成。" }, { status: error instanceof AuthError ? error.status : 500 }); }
}
