"use client";

import { useRef, useState, useTransition } from "react";
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
import { GripVertical, Maximize2, Trash2, UploadCloud, X } from "lucide-react";
import { deleteSlideAction, reorderSlidesAction } from "./actions";

const MAX_MB = 12;

export interface Slide {
  id: string;
  order: number;
  url: string | null;
}

type UploadStatus =
  | { kind: "idle" }
  | { kind: "uploading"; pct: number; index: number; total: number }
  | { kind: "error"; msg: string };

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
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-testid={`slide-${slide.id}`}
      className={`group relative aspect-video overflow-hidden rounded-xl border bg-navy/5 transition-all duration-150 ${
        isDragging
          ? "z-10 scale-[1.03] border-gold shadow-xl ring-2 ring-gold/50"
          : "border-navy/10 shadow-sm hover:-translate-y-0.5 hover:border-gold/40 hover:shadow-md"
      }`}
    >
      <button type="button" onClick={onOpen} className="block h-full w-full" title="View full screen">
        {slide.url ? <img src={slide.url} alt={`Slide ${index + 1}`} className="h-full w-full object-cover" /> : null}
      </button>

      {/* order badge */}
      <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-gold px-2 py-0.5 text-xs font-semibold text-navy shadow">
        {index + 1}
      </span>

      {/* fullscreen hint on hover */}
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-navy/0 opacity-0 transition group-hover:bg-navy/15 group-hover:opacity-100">
        <Maximize2 className="h-6 w-6 text-white drop-shadow" />
      </span>

      {/* drag handle */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        title="Drag to reorder"
        className="absolute bottom-2 left-2 cursor-grab rounded-lg bg-white/85 p-1 text-navy/60 shadow-sm backdrop-blur-sm transition hover:bg-white hover:text-navy active:cursor-grabbing sm:opacity-0 sm:group-hover:opacity-100"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* delete */}
      <button
        type="button"
        onClick={onRemove}
        data-testid={`slide-remove-${slide.id}`}
        aria-label="Remove slide"
        title="Remove slide"
        className="absolute right-2 top-2 rounded-full bg-white/85 p-1 text-rose shadow-sm backdrop-blur-sm transition hover:scale-110 hover:bg-rose hover:text-white sm:opacity-0 sm:group-hover:opacity-100"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}

export function SlideManager({ projectId, initialSlides }: { projectId: string; initialSlides: Slide[] }) {
  const [slides, setSlides] = useState<Slide[]>(initialSlides);
  const [status, setStatus] = useState<UploadStatus>({ kind: "idle" });
  const [lightbox, setLightbox] = useState<Slide | null>(null);
  const [dragOver, setDragOver] = useState(false);
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

  function uploadOne(file: File, index: number, total: number): Promise<Slide | null> {
    return new Promise((resolve) => {
      const fd = new FormData();
      fd.append("file", file);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/parvus-studio/projects/${projectId}/slides`);
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) setStatus({ kind: "uploading", pct: Math.round((ev.loaded / ev.total) * 100), index, total });
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve((JSON.parse(xhr.responseText) as { slide: Slide }).slide);
          } catch {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      };
      xhr.onerror = () => resolve(null);
      xhr.send(fd);
    });
  }

  async function uploadFiles(picked: File[]) {
    const valid = picked.filter((f) => f.type.startsWith("image/") && f.size <= MAX_MB * 1024 * 1024);
    const skipped = picked.length - valid.length;
    let failed = 0;
    for (let i = 0; i < valid.length; i++) {
      setStatus({ kind: "uploading", pct: 0, index: i + 1, total: valid.length });
      const slide = await uploadOne(valid[i]!, i + 1, valid.length);
      if (slide) setSlides((cur) => [...cur, slide]);
      else failed++;
    }
    if (fileRef.current) fileRef.current.value = "";
    const problems = skipped + failed;
    setStatus(
      problems > 0
        ? { kind: "error", msg: `${problems} file(s) skipped or failed (images only, under ${MAX_MB} MB).` }
        : { kind: "idle" },
    );
  }

  const uploading = status.kind === "uploading";

  return (
    <div className="space-y-3" data-testid="yt-slides">
      {slides.length > 0 ? (
        <>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
            <span className="inline-flex items-center gap-1"><GripVertical className="h-3.5 w-3.5" /> drag to reorder</span>
            <span className="inline-flex items-center gap-1"><Maximize2 className="h-3.5 w-3.5" /> click to enlarge</span>
            <span className="inline-flex items-center gap-1"><Trash2 className="h-3.5 w-3.5" /> hover to remove</span>
          </p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={slides.map((s) => s.id)} strategy={rectSortingStrategy}>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="slide-grid">
                {slides.map((s, i) => (
                  <SortableSlide key={s.id} slide={s} index={i} onOpen={() => setLightbox(s)} onRemove={() => remove(s.id)} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </>
      ) : null}

      {/* drag-and-drop upload zone (also the empty state) */}
      <div
        onClick={() => !uploading && fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files?.length) void uploadFiles(Array.from(e.dataTransfer.files));
        }}
        data-testid="slide-dropzone"
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-6 text-center transition ${
          dragOver ? "border-gold bg-gold/10" : "border-navy/20 bg-navy/[0.02] hover:border-gold/50 hover:bg-gold/5"
        } ${uploading ? "pointer-events-none opacity-60" : ""}`}
      >
        <UploadCloud className="h-7 w-7 text-navy/50" />
        {uploading ? (
          <p className="text-sm font-medium text-navy">Uploading {status.index} of {status.total}… {status.pct}%</p>
        ) : (
          <>
            <p className="text-sm font-medium text-navy">Drop slides here, or click to browse</p>
            <p className="text-xs text-gray-400">PNG or JPG · 1920×1080 · up to {MAX_MB} MB · select several at once</p>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void uploadFiles(Array.from(e.target.files));
          }}
          data-testid="slide-upload-input"
        />
      </div>

      {uploading ? (
        <div className="h-1.5 w-full overflow-hidden rounded bg-navy/10">
          <div className="h-full bg-gold transition-[width] duration-150" style={{ width: `${status.pct}%` }} />
        </div>
      ) : null}
      {status.kind === "error" ? <p className="text-sm text-rose" data-testid="slide-error">{status.msg}</p> : null}

      {lightbox ? (
        <div
          className="fixed inset-0 z-50 flex animate-[po-fade-in_150ms_ease-out] items-center justify-center bg-black/85 p-6"
          onClick={() => setLightbox(null)}
          data-testid="slide-lightbox"
        >
          {lightbox.url ? <img src={lightbox.url} alt="Slide" className="max-h-full max-w-full rounded-lg shadow-2xl" /> : null}
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full bg-white/90 p-1.5 text-navy shadow transition hover:scale-110 hover:bg-white"
            aria-label="Close"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
