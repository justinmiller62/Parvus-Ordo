"use server";

import { redirect } from "next/navigation";
import { createLesson } from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";

export async function createLessonAction(): Promise<void> {
  const v = await getViewer();
  const role = v?.identity?.role;
  const parishId = v?.identity?.parishId;
  if (!parishId || !(role === "catechist" || role === "admin" || role === "super_admin")) {
    redirect("/ocia");
  }
  const id = await createLesson({ parishId, createdBy: v!.identity!.userId });
  redirect(`/ocia/lessons/${id}/edit`);
}
