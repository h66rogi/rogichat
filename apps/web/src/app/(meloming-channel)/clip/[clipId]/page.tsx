import { notFound } from "next/navigation";
import { ClipDetailContent } from "@/features/clip-detail-content";

export default async function ClipPage({ params }: { params: Promise<{ clipId: string }> }) {
  const { clipId } = await params;
  if (!/^[1-9]\d{0,9}$/.test(clipId)) notFound();
  return <ClipDetailContent clipId={Number(clipId)} />;
}
