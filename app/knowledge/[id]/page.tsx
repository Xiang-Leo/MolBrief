import SectionPage from "../../section-page";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SectionPage view="knowledge" entityId={id}/>;
}
