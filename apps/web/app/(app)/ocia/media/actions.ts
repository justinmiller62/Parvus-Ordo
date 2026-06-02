"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createAsset,
  deleteAsset,
  getAsset,
  getStorage,
  updateAssetStatus,
  type AssetStatus,
  type TranscriptionStatus,
  type UploadTarget,
} from "@parvaordo/core";
import { requireStaff } from "@/src/lib/require-role";

/** Reserve a video on the host and create the asset row. Returns the upload ticket. */
export async function createVideoUploadAction(
  title: string,
): Promise<{ assetId: string; providerAssetId: string; target: UploadTarget }> {
  const { parishId, userId } = await requireStaff("/ocia");
  const storage = getStorage();
  const up = await storage.createUpload({ title: title || "Untitled video" });
  const assetId = await createAsset({
    parishId,
    createdBy: userId,
    kind: "video",
    title: title || "Untitled video",
    provider: storage.name,
    providerAssetId: up.providerAssetId,
    playbackUrl: up.playbackUrl,
    posterUrl: up.posterUrl,
    mimeType: "video/mp4",
  });
  return { assetId, providerAssetId: up.providerAssetId, target: up.target };
}

/** Bytes finished uploading → host begins transcoding. */
export async function markUploadedAction(assetId: string): Promise<void> {
  const { parishId } = await requireStaff("/ocia");
  await updateAssetStatus({ parishId, id: assetId, status: "processing" });
}

/** Poll the host for transcode progress and persist it. */
export async function pollStatusAction(assetId: string): Promise<{
  status: AssetStatus;
  progress: number;
  transcriptionStatus: TranscriptionStatus;
}> {
  const { parishId } = await requireStaff("/ocia");
  const asset = await getAsset(parishId, assetId);
  if (!asset || !asset.providerAssetId) redirect("/ocia/media");
  const s = await getStorage().videoStatus(asset.providerAssetId);
  // Only advance toward ready; don't clobber a row already past transcode.
  if (asset.status !== "ready") {
    await updateAssetStatus({
      parishId,
      id: assetId,
      status: s.status,
      durationMs: s.durationMs ?? undefined,
      playbackUrl: asset.playbackUrl ?? undefined,
    });
  }
  const fresh = await getAsset(parishId, assetId);
  return { status: s.status, progress: s.progress, transcriptionStatus: fresh?.transcriptionStatus ?? "none" };
}

export async function deleteAssetAction(assetId: string): Promise<void> {
  const { parishId } = await requireStaff("/ocia");
  const asset = await getAsset(parishId, assetId);
  if (asset?.providerAssetId) {
    try {
      await getStorage().delete(asset.providerAssetId);
    } catch {
      /* best-effort remote cleanup; the row still goes */
    }
  }
  await deleteAsset(parishId, assetId);
  revalidatePath("/ocia/media");
}
