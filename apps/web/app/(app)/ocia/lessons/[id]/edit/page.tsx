import { notFound, redirect } from "next/navigation";
import { getAsset, getLessonForEdit, listAssets } from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";
import { LessonBuilder, type ClipStatus } from "@/src/components/ocia/lesson-builder";
import type { VideoAssetOption } from "@/src/components/ocia/video-editor";

export default async function EditLessonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const viewer = await getViewer();
  const role = viewer?.identity?.role;
  const parishId = viewer?.identity?.parishId ?? null;
  if (!parishId || !(role === "catechist" || role === "admin" || role === "super_admin")) {
    redirect("/ocia");
  }

  const { id } = await params;
  const { v } = await searchParams;
  const lesson = await getLessonForEdit(parishId, id, v);
  if (!lesson) notFound();
  if (!lesson.editable) redirect(`/ocia/lessons/${id}`); // global/diocese content isn't parish-editable

  // Ready videos this parish can drop into a lesson (for the video item's trimmer).
  const videoAssets: VideoAssetOption[] = (await listAssets(parishId, { kind: "video" }))
    .filter((a) => a.status === "ready" && a.playbackUrl)
    .map((a) => ({
      id: a.id,
      title: a.title,
      durationMs: a.durationMs,
      playbackUrl: a.playbackUrl!,
      posterUrl: a.posterUrl,
    }));

  // Processing state of each video item's cut clip (drives the green/gray dot).
  const clipStatuses: Record<string, ClipStatus> = {};
  for (const it of lesson.selected.items) {
    if (it.kind !== "video") continue;
    const clipId = it.content.clip_asset_id as string | undefined;
    if (!clipId) {
      clipStatuses[it.id] = "none";
      continue;
    }
    const clip = await getAsset(parishId, clipId);
    clipStatuses[it.id] = !clip
      ? "none"
      : clip.status === "ready"
        ? "ready"
        : clip.status === "failed"
          ? "failed"
          : "processing";
  }

  // Re-mount when the selected version changes so local edit state re-initialises.
  return (
    <LessonBuilder
      key={lesson.selected.versionId}
      lesson={lesson}
      videoAssets={videoAssets}
      clipStatuses={clipStatuses}
    />
  );
}
