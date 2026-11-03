import { z } from "zod";
import { assertSameOrigin } from "@/lib/auth";
import { errorResponse, readBody, signedIn } from "@/lib/molbrief-server";
import { collectionStatus, enqueueCollection, saveCollectionSettings } from "@/lib/collection-server";
import { CollectionError } from "@/lib/collection-core.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
function failure(error: unknown) {
  if (error instanceof CollectionError) return Response.json({ error: error.message }, { status: error.status, headers });
  return errorResponse(error);
}
export async function GET() {
  try { await signedIn(); return Response.json(collectionStatus(), { headers }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    await signedIn();
    assertSameOrigin(request);
    const body = z.discriminatedUnion("action", [
      z.object({ action: z.literal("save"), settings: z.record(z.string(), z.unknown()) }).strict(),
      z.object({ action: z.literal("run"),mode:z.enum(["collect","summarize"]).optional(),limit:z.number().int().min(1).max(30).optional() }).strict(),
    ]).parse(await readBody(request, 16384));
    if (body.action === "save") return Response.json(saveCollectionSettings(body.settings), { headers });
    return Response.json(enqueueCollection(body.mode,body.limit), { status: 202, headers });
  } catch (error) { return failure(error); }
}
