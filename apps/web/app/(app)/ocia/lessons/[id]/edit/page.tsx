import { notFound, redirect } from "next/navigation";
import { getLessonForEdit } from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";
import { LessonBuilder } from "@/src/components/ocia/lesson-builder";

export default async function EditLessonPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  const role = viewer?.identity?.role;
  const parishId = viewer?.identity?.parishId ?? null;
  if (!parishId || !(role === "catechist" || role === "admin" || role === "super_admin")) {
    redirect("/ocia");
  }

  const { id } = await params;
  const lesson = await getLessonForEdit(parishId, id);
  if (!lesson) notFound();
  // Global/diocese content isn't parish-editable; send to the read-only view.
  if (!lesson.editable) redirect(`/ocia/lessons/${id}`);

  return <LessonBuilder lesson={lesson} />;
}
