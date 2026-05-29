"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
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
  GripVertical,
  HelpCircle,
  ListChecks,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { LessonForEdit, LessonItem, LessonItemKind } from "@parvaordo/core";
import { ReadingEditor } from "./reading-editor";
import { QuestionEditor } from "./question-editor";
import {
  addItemAction,
  deleteItemAction,
  publishAction,
  reorderAction,
  updateItemAction,
  updateLessonAction,
} from "@/app/(app)/ocia/lessons/[id]/edit/actions";

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

// Compact, sortable row — no inline editing (Edit opens the modal).
function SortableItem({
  item,
  index,
  onEdit,
  onDelete,
}: {
  item: LessonItem;
  index: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const text = preview(item);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab text-gray-400 hover:text-gray-600"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-500">
        {index + 1}
      </span>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${badgeFor(item)}`}>
        {kindLabel(item)}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-gray-700">
        {text || <span className="italic text-gray-400">Empty — click edit</span>}
      </span>
      <button onClick={onEdit} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gold-dark" aria-label="Edit">
        <Pencil className="h-4 w-4" />
      </button>
      <button onClick={onDelete} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-rose" aria-label="Delete">
        <Trash2 className="h-4 w-4" />
      </button>
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

export function LessonBuilder({ lesson }: { lesson: LessonForEdit }) {
  const [items, setItems] = useState<LessonItem[]>(lesson.items);
  const [title, setTitle] = useState(lesson.title);
  const [description, setDescription] = useState(lesson.description ?? "");
  const [published, setPublished] = useState(lesson.published);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const schedule = (key: string, fn: () => void) => {
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(fn, 600);
  };

  const onItemChange = (id: string, content: Record<string, unknown>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, content } : it)));
    schedule(`item-${id}`, () => void updateItemAction(lesson.id, id, content));
  };

  const onMetaChange = (nextTitle: string, nextDesc: string) => {
    setTitle(nextTitle);
    setDescription(nextDesc);
    schedule("lesson", () => void updateLessonAction(lesson.id, nextTitle, nextDesc));
  };

  const add = async (kind: LessonItemKind, format?: string) => {
    setBusy(true);
    try {
      const { id, content } = await addItemAction(lesson.id, kind, format);
      setItems((prev) => [...prev, { id, position: prev.length, kind, content }]);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    if (editingId === id) setEditingId(null);
    await deleteItemAction(lesson.id, id);
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
      void reorderAction(
        lesson.id,
        next.map((i) => i.id),
      );
      return next;
    });
  };

  const togglePublish = async () => {
    const next = !published;
    setPublished(next);
    await publishAction(lesson.id, next);
  };

  const editingItem = items.find((i) => i.id === editingId) ?? null;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link href="/ocia/lessons" className="text-sm text-gray-400 hover:text-navy">
          ← Lessons
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href={`/ocia/lessons/${lesson.id}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-parchment"
          >
            <Eye className="h-4 w-4" />
            Preview
          </Link>
          <button
            onClick={togglePublish}
            data-testid="publish-toggle"
            className={`rounded-md px-3 py-1.5 text-sm font-medium text-white ${
              published ? "bg-green-600 hover:bg-green-700" : "bg-gold hover:bg-gold-dark"
            }`}
          >
            {published ? "Published" : "Publish"}
          </button>
        </div>
      </div>

      <input
        value={title}
        onChange={(e) => onMetaChange(e.target.value, description)}
        placeholder="Lesson title"
        data-testid="lesson-title"
        className="w-full bg-transparent font-heading text-2xl text-navy focus:outline-none"
      />
      <textarea
        value={description}
        onChange={(e) => onMetaChange(title, e.target.value)}
        rows={2}
        placeholder="Description (optional)"
        className="mt-1 w-full resize-none bg-transparent text-sm text-gray-500 focus:outline-none"
      />

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-4">
        <span className="mr-1 text-xs font-medium text-gray-400" data-testid="section-count">
          {items.length} sections
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
      </div>

      {items.length === 0 ? (
        <div className="mt-4 rounded-lg border-2 border-dashed border-gray-300 p-10 text-center text-sm text-gray-500">
          No content yet. Add reading blocks and questions to build the lesson.
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <div className="mt-4 space-y-2">
              {items.map((item, index) => (
                <SortableItem
                  key={item.id}
                  item={item}
                  index={index}
                  onEdit={() => setEditingId(item.id)}
                  onDelete={() => remove(item.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Edit modal — full screen on mobile, centered panel on desktop. Auto-saves; close with X. */}
      {editingItem ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-6">
          <div className="absolute inset-0 bg-black/50 animate-[po-fade-in_150ms_ease-out]" onClick={() => setEditingId(null)} />
          <div className="relative flex h-full w-full flex-col bg-white animate-[po-slide-up_200ms_ease-out] md:h-[85vh] md:max-w-3xl md:rounded-xl md:shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3.5">
              <h2 className="font-heading text-lg text-navy">Edit {kindLabel(editingItem)}</h2>
              <button
                onClick={() => setEditingId(null)}
                aria-label="Close editor"
                className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-navy"
              >
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
                <p className="text-sm text-gray-400">Video items arrive with the asset manager (Slice 5).</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
