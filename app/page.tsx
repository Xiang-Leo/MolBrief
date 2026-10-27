import MolBrief from "./molbrief";
import { requireCurrentUser } from "@/lib/auth";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function Page() {
  const user = await requireCurrentUser();
  return <MolBrief signedIn={true} displayName={user.displayName}/>;
}
