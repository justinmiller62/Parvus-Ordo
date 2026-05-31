import { redirect } from "next/navigation";
import { listAssets } from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";
import { MediaUploader } from "@/src/components/ocia/media-uploader";
import { AssetGrid, type GridAsset } from "@/src/components/ocia/asset-grid";

export default async function MediaPage() {
  const viewer = await getViewer();
  const role = viewer?.identity?.role;
  const parishId = viewer?.identity?.parishId;
  const canManage = role === "catechist" || role === "admin" || role === "super_admin";
  if (!parishId || !canManage) redirect("/ocia");

  const assets = await listAssets(parishId);
  const grid: GridAsset[] = assets.map((a) => ({
    id: a.id,
    kind: a.kind,
    title: a.title,
    status: a.status,
    transcriptionStatus: a.transcriptionStatus,
    posterUrl: a.posterUrl,
    durationMs: a.durationMs,
  }));

  return (
    <div className="w-full">
      <h1 className="mb-1 font-heading text-2xl text-navy">Media Library</h1>
      <p className="mb-4 text-sm text-gray-500">
        Upload videos for your lessons. Each video is transcoded for streaming and transcribed automatically.
      </p>
      <MediaUploader />
      <AssetGrid assets={grid} />
    </div>
  );
}
