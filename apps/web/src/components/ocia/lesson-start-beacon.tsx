"use client";

import { useEffect, useRef } from "react";
import { recordLessonStartAction } from "@/app/(app)/ocia/lessons/[id]/actions";

/**
 * Fires `lesson_start` engagement telemetry once when an active learner enters a lesson.
 * Fire-and-forget — never blocks the player; the write is idempotent server-side, so a
 * resume or a remount can't double-count. Mounted only for an active (non-preview/review)
 * learner at the first step, so previewing teachers generate no engagement.
 */
export function LessonStartBeacon({ lessonId, versionId }: { lessonId: string; versionId: string }): null {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    void recordLessonStartAction(lessonId, versionId);
  }, [lessonId, versionId]);
  return null;
}
