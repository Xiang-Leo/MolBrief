import { assertSameOrigin, verifyServiceToken } from "@/lib/auth";
import { errorResponse } from "@/lib/molbrief-server";
import { tickCollection } from "@/lib/collection-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  // A browser session cannot invoke the worker endpoint or override its clock,
  // due time, provider configuration, or daily call budget.
  if (!verifyServiceToken(request)) return Response.json({ error: "采集执行需要有效的服务令牌。" }, { status: 401, headers });
  try {
    assertSameOrigin(request);
    return Response.json(await tickCollection(), { headers });
  } catch (error) { return errorResponse(error); }
}
