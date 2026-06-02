"use server";

import { isStaff } from "@parvaordo/shared";
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
import { getViewer } from "@/src/lib/viewer";

async function requireBuilder(): Promise<{ parishId: string; userId: string }> {
  const v = await getViewer();
  const role = v?.identity?.role;
  const parishId = v?.identity?.parishId;
  const userId = v?.identity?.userId;
  if (!parishId || !userId || !isStaff(role)) {
    redirect("/ocia");
  }
  return { parishId, userId };
}

/** Reserve a video on the host and create the asset row. Returns the upload ticket. */
export async function createVideoUploadAction(
  title: string,
): Promise<{ assetId: string; providerAssetId: string; target: UploadTarget }> {
  const { parishId, userId } = await requireBuilder();
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
  const { parishId } = await requireBuilder();
  await updateAssetStatus({ parishId, id: assetId, status: "processing" });
}

/** Poll the host for transcode progress and persist it. */
export async function pollStatusAction(assetId: string): Promise<{
  status: AssetStatus;
  progress: number;
  transcriptionStatus: TranscriptionStatus;
}> {
  const { parishId } = await requireBuilder();
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
  const { parishId } = await requireBuilder();
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
