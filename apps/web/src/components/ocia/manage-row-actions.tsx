"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, MessageSquare, Trash2 } from "lucide-react";
import { deleteLessonFromListAction, unpublishLessonFromListAction } from "@/app/(app)/ocia/lessons/actions";

const ICON = "rounded p-1 text-gray-400 hover:bg-gray-100";

/** Per-row actions on the manage list: preview, unpublish, delete (parish only). */
export function ManageRowActions({
  lessonId,
  editable,
  status,
}: {
  lessonId: string;
  editable: boolean; // parish-owned → can unpublish/delete
  status: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Link href={`/ocia/lessons/${lessonId}?preview=1`} title="Preview as student" className={`${ICON} hover:text-navy`}>
        <Eye className="h-4 w-4" />
      </Link>
      <Link href={`/ocia/lessons/${lessonId}/responses`} title="Student questions & feedback" className={`${ICON} hover:text-navy`}>
        <MessageSquare className="h-4 w-4" />
      </Link>
      {editable && status === "published" ? (
        <button
          onClick={() => startTransition(async () => { await unpublishLessonFromListAction(lessonId); router.refresh(); })}
          disabled={pending}
          className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-50"
        >
          Unpublish
        </button>
      ) : null}
      {editable ? (
        <button
          onClick={() => {
            if (!window.confirm("Delete this lesson and all its versions? This cannot be undone.")) return;
            startTransition(async () => {
              await deleteLessonFromListAction(lessonId);
              router.refresh();
            });
          }}
          disabled={pending}
          title="Delete lesson"
          className={`${ICON} hover:text-rose disabled:opacity-50`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
