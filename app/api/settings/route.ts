import { assertSameOrigin, AuthError, getCurrentUser } from '@/lib/auth';
import { getServiceSettings, saveServiceSettings, ServiceConfigError, verifyService } from '@/lib/service-config';
import type { ServiceFieldName, ServiceName } from '@/lib/service-config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

async function owner() {
  if (!(await getCurrentUser())) throw new AuthError('请先登录后管理服务配置。', 401);
}
function failure(error: unknown) {
  if (error instanceof AuthError || error instanceof ServiceConfigError) {
    return Response.json({ error: error.message }, { status: error.status, headers });
  }
  // Provider responses, request details and credentials must never enter logs.
  return Response.json({ error: '服务配置操作未完成，请稍后重试。' }, { status: 500, headers });
}
async function input(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new ServiceConfigError('服务配置需以 JSON 提交。');
  if (Number(request.headers.get('content-length') || 0) > 16384) throw new ServiceConfigError('服务配置内容过长。', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ServiceConfigError('服务配置内容为空。');
  let bytes = 0, raw = '';
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 16384) { await reader.cancel(); throw new ServiceConfigError('服务配置内容过长。', 413); }
      raw += decoder.decode(part.value, { stream: true });
    }
    raw += decoder.decode();
  } finally { reader.releaseLock(); }
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new ServiceConfigError('服务配置格式不正确。'); }
}

export async function GET() {
  try { await owner(); return Response.json(getServiceSettings(), { headers }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    await owner();
    assertSameOrigin(request);
    const body = await input(request);
    if (body.action === 'save') {
      if (Object.keys(body).some(name => !['action', 'values', 'clear'].includes(name))) throw new ServiceConfigError('包含不支持的配置操作。');
      return Response.json(saveServiceSettings((body.values ?? {}) as Partial<Record<ServiceFieldName, string>>, (body.clear ?? []) as ServiceFieldName[]), { headers });
    }
    if (body.action === 'verify') {
      if (Object.keys(body).some(name => !['action', 'service'].includes(name)) || !['parallel', 'llm', 'tts'].includes(body.service as string)) throw new ServiceConfigError('请选择支持的服务。');
      const { httpStatus, ...result } = await verifyService(body.service as ServiceName);
      return Response.json(result, { status: httpStatus, headers });
    }
    throw new ServiceConfigError('请选择保存或验证服务配置。');
  } catch (error) { return failure(error); }
}
