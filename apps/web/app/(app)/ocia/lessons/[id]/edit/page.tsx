import { notFound, redirect } from "next/navigation";
import { getLessonForEdit } from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";
import { LessonBuilder } from "@/src/components/ocia/lesson-builder";

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

  // Re-mount when the selected version changes so local edit state re-initialises.
  return <LessonBuilder key={lesson.selected.versionId} lesson={lesson} />;
}
