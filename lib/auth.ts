import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  AuthError, enforceSameOrigin, readAuthConfig, serviceTokenMatches,
  SESSION_COOKIE, verifySession,
} from "./auth-core";
export { AuthError } from "./auth-core";
export type { User } from "./auth-core";

export function isAuthConfigured(): boolean { return readAuthConfig() !== null; }

export async function getCurrentUser() {
  const config = readAuthConfig();
  if (!config) return null;
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value, config);
}

export async function requireCurrentUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export function verifyServiceToken(request: Request): boolean {
  const config = readAuthConfig();
  return config ? serviceTokenMatches(request, config) : false;
}

export function assertSameOrigin(request: Request): void {
  const config = readAuthConfig();
  if (!config) throw new AuthError("站点尚未完成账号配置，请先在服务器运行初始化脚本。", 503);
  enforceSameOrigin(request, config);
}
