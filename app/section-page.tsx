import MolBrief from "./molbrief";
import type { View } from "./molbrief";
import { requireCurrentUser } from "@/lib/auth";

export default async function SectionPage({ view, entityId }: { view: View; entityId?: string }) {
  const user = await requireCurrentUser();
  return <MolBrief signedIn displayName={user.displayName} initialView={view} initialEntityId={entityId}/>;
}
