"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X } from "lucide-react";
import { deleteSlideAction, reorderSlidesAction } from "./actions";

const MAX_MB = 12;

export interface Slide {
  id: string;
  order: number;
  url: string | null;
}

type UploadStatus = { kind: "idle" } | { kind: "uploading"; pct: number } | { kind: "error"; msg: string };

function SortableSlide({
  slide,
  index,
  onOpen,
  onRemove,
}: {
  slide: Slide;
  index: number;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slide.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <li ref={setNodeRef} style={style} className="group relative" data-testid={`slide-${slide.id}`}>
      <button
        type="button"
        onClick={onOpen}
        className="block aspect-video w-full overflow-hidden rounded-md border border-navy/15 bg-navy/5"
        title="View full screen"
      >
        {slide.url ? <img src={slide.url} alt={`Slide ${index + 1}`} className="h-full w-full object-cover" /> : null}
      </button>
      <span className="absolute left-1 top-1 rounded bg-navy/80 px-1.5 text-xs font-medium text-cream">{index + 1}</span>
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="absolute bottom-1 left-1 cursor-grab rounded bg-white/90 p-0.5 text-navy/70 opacity-0 group-hover:opacity-100 active:cursor-grabbing"
        title="Drag to reorder"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onRemove}
        data-testid={`slide-remove-${slide.id}`}
        className="absolute right-1 top-1 rounded-full bg-white/90 p-0.5 text-rose opacity-0 hover:bg-rose hover:text-white group-hover:opacity-100"
        title="Remove slide"
        aria-label="Remove slide"
      >
        <X className="h-4 w-4" />
      </button>
    </li>
  );
}

export function SlideManager({ projectId, initialSlides }: { projectId: string; initialSlides: Slide[] }) {
  const router = useRouter();
  const [slides, setSlides] = useState<Slide[]>(initialSlides);
  const [status, setStatus] = useState<UploadStatus>({ kind: "idle" });
  const [lightbox, setLightbox] = useState<Slide | null>(null);
  const [, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = slides.findIndex((s) => s.id === active.id);
    const newIndex = slides.findIndex((s) => s.id === over.id);
    const next = arrayMove(slides, oldIndex, newIndex);
    setSlides(next);
    startTransition(() => reorderSlidesAction(projectId, next.map((s) => s.id)));
  }

  function remove(slideId: string) {
    setSlides((cur) => cur.filter((s) => s.id !== slideId));
    startTransition(() => deleteSlideAction(projectId, slideId));
  }

  function upload(file: File) {
    if (!file.type.startsWith("image/")) return setStatus({ kind: "error", msg: "Slide must be an image (PNG or JPG)." });
    if (file.size > MAX_MB * 1024 * 1024) {
      return setStatus({ kind: "error", msg: `Slide is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ${MAX_MB} MB.` });
    }
    const fd = new FormData();
    fd.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/parvus-studio/projects/${projectId}/slides`);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) setStatus({ kind: "uploading", pct: Math.round((ev.loaded / ev.total) * 100) });
    };
    xhr.onload = () => {
      if (fileRef.current) fileRef.current.value = "";
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const { slide } = JSON.parse(xhr.responseText) as { slide: Slide };
          setSlides((cur) => [...cur, slide]);
        } catch {
          router.refresh();
        }
        setStatus({ kind: "idle" });
      } else {
        let msg = "Upload failed.";
        try {
          msg = (JSON.parse(xhr.responseText) as { error?: string }).error ?? msg;
        } catch {
          /* keep default */
        }
        setStatus({ kind: "error", msg });
      }
    };
    xhr.onerror = () => setStatus({ kind: "error", msg: "Network error — please try again." });
    setStatus({ kind: "uploading", pct: 0 });
    xhr.send(fd);
  }

  const uploading = status.kind === "uploading";

  return (
    <div className="space-y-3" data-testid="yt-slides">
      {slides.length > 0 ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={slides.map((s) => s.id)} strategy={rectSortingStrategy}>
            <ul className="grid grid-cols-3 gap-3" data-testid="slide-grid">
              {slides.map((s, i) => (
                <SortableSlide key={s.id} slide={s} index={i} onOpen={() => setLightbox(s)} onRemove={() => remove(s.id)} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : (
        <p className="text-sm text-gray-500">No slides yet — upload your first below.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
          }}
          className="text-sm text-navy"
          data-testid="slide-upload-input"
        />
        {uploading ? <span className="text-sm text-gray-500">Uploading… {status.pct}%</span> : null}
      </div>
      {uploading ? (
        <div className="h-1.5 w-full overflow-hidden rounded bg-navy/10">
          <div className="h-full bg-gold transition-[width] duration-150" style={{ width: `${status.pct}%` }} />
        </div>
      ) : null}
      {status.kind === "error" ? <p className="text-sm text-rose" data-testid="slide-error">{status.msg}</p> : null}

      {lightbox ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setLightbox(null)}
          data-testid="slide-lightbox"
        >
          {lightbox.url ? <img src={lightbox.url} alt="Slide" className="max-h-full max-w-full rounded-md" /> : null}
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full bg-white/90 p-1 text-navy"
            aria-label="Close"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
