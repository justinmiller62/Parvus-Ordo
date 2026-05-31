"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Eye,
  FileText,
  Film,
  GripVertical,
  HelpCircle,
  ListChecks,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { LessonForEdit, LessonItem, LessonItemKind, VersionSummary } from "@parvaordo/core";
import { estimateItemsDurationMin } from "@parvaordo/shared";
import { ReadingEditor } from "./reading-editor";
import { QuestionEditor } from "./question-editor";
import { VideoEditor, type VideoAssetOption } from "./video-editor";
import {
  addItemAction,
  deleteItemAction,
  deleteLessonAction,
  deleteVersionAction,
  ensureDraftAction,
  materializeClipAction,
  publishAction,
  reorderAction,
  unpublishAction,
  updateItemAction,
  updateMetaAction,
} from "@/app/(app)/ocia/lessons/[id]/edit/actions";

export type ClipStatus = "none" | "processing" | "ready" | "failed";

function kindLabel(item: LessonItem): string {
  if (item.kind === "reading") return "Reading";
  if (item.kind === "video") return "Video";
  return item.content.format === "multiple_choice" ? "Multiple Choice" : "Open-Ended";
}

function badgeFor(item: LessonItem): string {
  if (item.kind === "reading") return "bg-gold/15 text-gold-dark";
  if (item.kind === "video") return "bg-teal-50 text-teal-700";
  return item.content.format === "multiple_choice" ? "bg-amber-50 text-amber-700" : "bg-rose/10 text-rose";
}

function preview(item: LessonItem): string {
  const raw =
    item.kind === "reading"
      ? String(item.content.html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
      : item.kind === "question"
        ? String(item.content.prompt ?? "")
        : "Video segment";
  return raw.length > 80 ? `${raw.slice(0, 80)}…` : raw;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Format manually (not toLocaleString) so the SSR and client strings match — the
// browser's and Node's ICU disagree on the separator ("28, 11:20" vs "28 at 11:20"),
// which otherwise triggers a hydration mismatch in this Client Component.
function fmtStamp(iso: string): string {
  const d = new Date(iso);
  let h = d.getHours();
  const ap = h < 12 ? "AM" : "PM";
  h = h % 12 || 12;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${h}:${String(d.getMinutes()).padStart(2, "0")} ${ap}`;
}

function versionLabel(v: VersionSummary): string {
  const when = v.isDraft ? v.updatedAt : v.publishedAt;
  const stamp = when ? fmtStamp(when) : "";
  // Only the live version is "Live"; older published versions are kept as history.
  if (v.isDraft) return `Draft · edited ${stamp}`;
  return v.isLive ? `Live · ${stamp}` : `Previous · ${stamp}`;
}

const CLIP_DOT: Record<ClipStatus, string> = {
  none: "bg-gray-300",
  processing: "bg-amber-400 animate-pulse",
  ready: "bg-green-500",
  failed: "bg-rose",
};

function ItemRow({
  item,
  index,
  editable,
  clipStatus,
  onEdit,
  onDelete,
}: {
  item: LessonItem;
  index: number;
  editable: boolean;
  clipStatus?: ClipStatus;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !editable,
  });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const text = preview(item);

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
      {editable ? (
        <button {...attributes} {...listeners} className="cursor-grab text-gray-400 hover:text-gray-600" aria-label="Drag to reorder">
          <GripVertical className="h-4 w-4" />
        </button>
      ) : (
        <span className="w-4" />
      )}
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-500">
        {index + 1}
      </span>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${badgeFor(item)}`}>{kindLabel(item)}</span>
      {item.kind === "video" ? (
        <span
          title={`Clip: ${clipStatus ?? "none"}`}
          data-testid="clip-dot"
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${CLIP_DOT[clipStatus ?? "none"]}`}
        />
      ) : null}
      <span className="min-w-0 flex-1 truncate text-sm text-gray-700">
        {text || <span className="italic text-gray-400">Empty — click edit</span>}
      </span>
      {editable ? (
        <>
          <button onClick={onEdit} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gold-dark" aria-label="Edit">
            <Pencil className="h-4 w-4" />
          </button>
          <button onClick={onDelete} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-rose" aria-label="Delete">
            <Trash2 className="h-4 w-4" />
          </button>
        </>
      ) : null}
    </div>
  );
}

function AddButton({ onClick, disabled, children }: { onClick: () => void; disabled: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-parchment disabled:opacity-50"
    >
      <Plus className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

export function LessonBuilder({
  lesson,
  videoAssets,
  clipStatuses,
}: {
  lesson: LessonForEdit;
  videoAssets: VideoAssetOption[];
  clipStatuses: Record<string, ClipStatus>;
}) {
  const router = useRouter();
  const lessonId = lesson.lessonId;
  const { versionId, isDraft, isLive } = lesson.selected;
  const editable = isDraft; // only the draft is editable (page already checked parish ownership)

  const [items, setItems] = useState<LessonItem[]>(lesson.selected.items);
  const [title, setTitle] = useState(lesson.selected.title);
  const [description, setDescription] = useState(lesson.selected.description ?? "");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [generatingClip, setGeneratingClip] = useState(false);
  const [pending, startTransition] = useTransition();
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Debounced autosave that can be FLUSHED — a keystroke <600ms before closing the
  // modal / publishing / switching versions / navigating must not be lost.
  const pendingSaves = useRef<Record<string, () => Promise<void>>>({});
  const schedule = (key: string, fn: () => Promise<void>) => {
    clearTimeout(timers.current[key]);
    pendingSaves.current[key] = fn;
    timers.current[key] = setTimeout(() => {
      delete timers.current[key];
      delete pendingSaves.current[key];
      void fn();
    }, 600);
  };
  const flush = async () => {
    const fns: Array<() => Promise<void>> = [];
    for (const key of Object.keys(timers.current)) {
      clearTimeout(timers.current[key]);
      delete timers.current[key];
      const f = pendingSaves.current[key];
      delete pendingSaves.current[key];
      if (f) fns.push(f);
    }
    await Promise.all(fns.map((f) => f()));
  };

  const onItemChange = (id: string, content: Record<string, unknown>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, content } : it)));
    schedule(`item-${id}`, () => updateItemAction(lessonId, versionId, id, content));
  };

  const onMetaChange = (nextTitle: string, nextDesc: string) => {
    setTitle(nextTitle);
    setDescription(nextDesc);
    schedule("meta", () => updateMetaAction(lessonId, versionId, nextTitle, nextDesc));
  };

  const add = async (kind: LessonItemKind, format?: string) => {
    setBusy(true);
    try {
      const { id, content } = await addItemAction(lessonId, versionId, kind, format);
      setItems((prev) => [...prev, { id, position: prev.length, kind, content }]);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    if (editingId === id) setEditingId(null);
    await deleteItemAction(lessonId, versionId, id);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const next = arrayMove(
        prev,
        prev.findIndex((i) => i.id === active.id),
        prev.findIndex((i) => i.id === over.id),
      );
      void reorderAction(lessonId, versionId, next.map((i) => i.id));
      return next;
    });
  };

  const switchVersion = async (vid: string) => {
    await flush();
    router.push(`/ocia/lessons/${lessonId}/edit?v=${vid}`);
  };
  const run = (fn: () => Promise<void>) =>
    startTransition(async () => {
      await flush(); // persist pending edits before publish/version actions
      await fn();
      router.refresh();
    });
  const confirmRun = (message: string, fn: () => Promise<void>) => {
    if (typeof window !== "undefined" && !window.confirm(message)) return;
    run(fn);
  };

  const editingItem = items.find((i) => i.id === editingId) ?? null;

  // While any clip is still being cut, refresh to pick up the cutter's status
  // callback (the dot flips processing → ready on its own).
  const anyClipProcessing = Object.values(clipStatuses).some((s) => s === "processing");
  useEffect(() => {
    if (!anyClipProcessing) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [anyClipProcessing, router]);

  const generateClip = async () => {
    if (!editingItem) return;
    const sourceId = editingItem.content.asset_id as string | undefined;
    if (!sourceId) return;
    // materializeClipAction persists the item content authoritatively (incl. clip_asset_id),
    // so drop any stale pending autosave for this item — otherwise flush() would clobber it.
    const key = `item-${editingItem.id}`;
    clearTimeout(timers.current[key]);
    delete timers.current[key];
    delete pendingSaves.current[key];
    setGeneratingClip(true);
    try {
      const { clipAssetId } = await materializeClipAction(
        lessonId,
        versionId,
        editingItem.id,
        sourceId,
        Number(editingItem.content.start_ms ?? 0),
        editingItem.content.end_ms == null ? null : Number(editingItem.content.end_ms),
      );
      setItems((prev) =>
        prev.map((it) => (it.id === editingItem.id ? { ...it, content: { ...it.content, clip_asset_id: clipAssetId } } : it)),
      );
      router.refresh();
    } finally {
      setGeneratingClip(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      {/* Top bar: back · version selector · actions */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Link href="/ocia/lessons" className="text-sm text-gray-400 hover:text-navy">
          ← Lessons
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={versionId}
            onChange={(e) => switchVersion(e.target.value)}
            data-testid="version-select"
            className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700"
          >
            {lesson.versions.map((v) => (
              <option key={v.id} value={v.id}>
                {versionLabel(v)}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={async () => {
              await flush(); // persist source/trim edits before previewing
              router.push(`/ocia/lessons/${lessonId}?v=${versionId}&preview=1`);
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-parchment"
          >
            <Eye className="h-4 w-4" />
            Preview
          </button>

          {isDraft ? (
            <button
              onClick={() => run(() => publishAction(lessonId, versionId))}
              disabled={pending}
              data-testid="publish-btn"
              className="rounded-md bg-gold px-3 py-1.5 text-sm font-medium text-white hover:bg-gold-dark disabled:opacity-50"
            >
              Publish
            </button>
          ) : isLive ? (
            <button
              onClick={() => run(() => unpublishAction(lessonId))}
              disabled={pending}
              data-testid="unpublish-btn"
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-parchment disabled:opacity-50"
            >
              Unpublish
            </button>
          ) : (
            <button
              onClick={() => run(() => publishAction(lessonId, versionId))}
              disabled={pending}
              data-testid="makelive-btn"
              className="rounded-md bg-gold px-3 py-1.5 text-sm font-medium text-white hover:bg-gold-dark disabled:opacity-50"
            >
              Make live
            </button>
          )}

          {!isDraft ? (
            <button
              onClick={() => run(() => ensureDraftAction(lessonId))}
              disabled={pending}
              data-testid="edit-btn"
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-parchment disabled:opacity-50"
            >
              Edit
            </button>
          ) : null}

          {lesson.liveVersionId ? (
            <button
              onClick={() => run(() => unpublishAction(lessonId))}
              disabled={pending}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
            >
              Unpublish all
            </button>
          ) : null}

          {isDraft ? (
            <button
              onClick={() => confirmRun("Discard this draft? Unpublished edits will be lost.", () => deleteVersionAction(lessonId, versionId))}
              disabled={pending}
              data-testid="discard-draft-btn"
              className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
            >
              Discard draft
            </button>
          ) : !isLive ? (
            <button
              onClick={() => confirmRun("Delete this version from history?", () => deleteVersionAction(lessonId, versionId))}
              disabled={pending}
              data-testid="delete-version-btn"
              className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
            >
              Delete version
            </button>
          ) : null}

          <button
            onClick={() => confirmRun("Delete this lesson and all its versions? This cannot be undone.", () => deleteLessonAction(lessonId))}
            disabled={pending}
            data-testid="delete-lesson-btn"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-rose hover:bg-rose/5 disabled:opacity-50"
          >
            Delete lesson
          </button>
        </div>
      </div>

      {editable ? (
        <input
          value={title}
          onChange={(e) => onMetaChange(e.target.value, description)}
          placeholder="Lesson title"
          data-testid="lesson-title"
          className="w-full bg-transparent font-heading text-2xl text-navy focus:outline-none"
        />
      ) : (
        <h1 className="font-heading text-2xl text-navy">{title}</h1>
      )}
      {editable ? (
        <textarea
          value={description}
          onChange={(e) => onMetaChange(title, e.target.value)}
          rows={2}
          placeholder="Description (optional)"
          className="mt-1 w-full resize-none bg-transparent text-sm text-gray-500 focus:outline-none"
        />
      ) : description ? (
        <p className="mt-1 text-sm text-gray-500">{description}</p>
      ) : null}

      {editable ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-4">
          <span className="mr-1 text-xs font-medium text-gray-400" data-testid="section-count">
            {items.length} sections
          </span>
          <span className="mr-1 text-xs text-gray-400" data-testid="duration-estimate">
            · ~{estimateItemsDurationMin(items)} min
          </span>
          <AddButton onClick={() => add("reading")} disabled={busy}>
            <FileText className="h-3.5 w-3.5" />
            Reading
          </AddButton>
          <AddButton onClick={() => add("question", "open_ended")} disabled={busy}>
            <HelpCircle className="h-3.5 w-3.5" />
            Open-Ended
          </AddButton>
          <AddButton onClick={() => add("question", "multiple_choice")} disabled={busy}>
            <ListChecks className="h-3.5 w-3.5" />
            Multiple Choice
          </AddButton>
          <AddButton onClick={() => add("video")} disabled={busy}>
            <Film className="h-3.5 w-3.5" />
            Video
          </AddButton>
        </div>
      ) : (
        <div className="mt-4 border-t border-gray-200 pt-4 text-xs font-medium text-gray-400">
          Viewing the {isLive ? "live" : "previous"} version · {items.length} sections · read-only
        </div>
      )}

      {items.length === 0 ? (
        <div className="mt-4 rounded-lg border-2 border-dashed border-gray-300 p-10 text-center text-sm text-gray-500">
          No content yet. Add reading blocks and questions to build the lesson.
        </div>
      ) : (
        <DndContext id="lesson-builder" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <div className="mt-4 space-y-2">
              {items.map((item, index) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  index={index}
                  editable={editable}
                  clipStatus={clipStatuses[item.id]}
                  onEdit={() => setEditingId(item.id)}
                  onDelete={() => remove(item.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {editingItem ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-6">
          <div className="absolute inset-0 bg-black/50 animate-[po-fade-in_150ms_ease-out]" onClick={() => {
              void flush();
              setEditingId(null);
            }} />
          <div className="relative flex h-full w-full flex-col bg-white animate-[po-slide-up_200ms_ease-out] md:h-[85vh] md:max-w-3xl md:rounded-xl md:shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3.5">
              <h2 className="font-heading text-lg text-navy">Edit {kindLabel(editingItem)}</h2>
              <button onClick={() => {
              void flush();
              setEditingId(null);
            }} aria-label="Close editor" className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-navy">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto px-5 py-5">
              {editingItem.kind === "reading" ? (
                <ReadingEditor
                  key={editingItem.id}
                  html={String(editingItem.content.html ?? "")}
                  onChange={(html) => onItemChange(editingItem.id, { ...editingItem.content, html })}
                />
              ) : editingItem.kind === "question" ? (
                <QuestionEditor content={editingItem.content} onChange={(c) => onItemChange(editingItem.id, c)} />
              ) : (
                <VideoEditor
                  content={editingItem.content}
                  assets={videoAssets}
                  onChange={(c) => onItemChange(editingItem.id, c)}
                  clipStatus={clipStatuses[editingItem.id] ?? (editingItem.content.clip_asset_id ? "processing" : "none")}
                  onGenerateClip={generateClip}
                  generating={generatingClip}
                />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
