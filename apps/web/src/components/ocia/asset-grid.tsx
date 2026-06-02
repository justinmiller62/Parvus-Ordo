"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Film, Image as ImageIcon, Loader2, Music, RotateCcw, Trash2 } from "lucide-react";
import type { AssetKind, AssetStatus, TranscriptionStatus } from "@parvaordo/core";
import { extractAudioWav } from "@/src/lib/audio-extract";
import { deleteAssetAction, pollStatusAction } from "@/app/(app)/ocia/media/actions";

export interface GridAsset {
  id: string;
  kind: AssetKind;
  title: string;
  status: AssetStatus;
  transcriptionStatus: TranscriptionStatus;
  posterUrl: string | null;
  durationMs: number | null;
}

const KIND_ICON = { video: Film, image: ImageIcon, audio: Music, pdf: FileText } as const;

function fmtDuration(ms: number | null): string {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function StatusBadge({ status }: { status: AssetStatus }) {
  const map: Record<AssetStatus, string> = {
    created: "bg-gray-100 text-gray-500",
    uploading: "bg-amber-50 text-amber-700",
    processing: "bg-amber-50 text-amber-700",
    ready: "bg-green-100 text-green-700",
    failed: "bg-rose/15 text-rose",
  };
  const label = status === "ready" ? "Ready" : status === "failed" ? "Failed" : "Processing…";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${map[status]}`}>{label}</span>;
}

function TranscriptBadge({ status }: { status: TranscriptionStatus }) {
  if (status === "none") return null;
  const text = status === "completed" ? "Transcript ✓" : status === "failed" ? "Transcript failed" : "Transcribing…";
  const cls = status === "completed" ? "text-green-700" : status === "failed" ? "text-rose" : "text-gray-400";
  return <span className={`text-xs ${cls}`}>{text}</span>;
}

export function AssetGrid({ assets }: { assets: GridAsset[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const retryTarget = useRef<string | null>(null);

  const startRetry = (id: string) => {
    retryTarget.current = id;
    fileRef.current?.click();
  };
  const onRetryFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const id = retryTarget.current;
    e.target.value = "";
    if (!file || !id) return;
    setRetrying(id);
    try {
      const wav = await extractAudioWav(file);
      await fetch(`/api/ocia/transcribe/${id}`, {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: wav,
      });
      router.refresh();
    } finally {
      setRetrying(null);
    }
  };

  // Drive any still-transcoding asset toward completion, then refresh.
  const pending = assets.filter((a) => a.status !== "ready" && a.status !== "failed");
  useEffect(() => {
    if (pending.length === 0) return;
    const t = setInterval(async () => {
      await Promise.all(pending.map((a) => pollStatusAction(a.id).catch(() => null)));
      router.refresh();
    }, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending.map((a) => a.id).join(",")]);

  if (assets.length === 0) {
    return <p className="mt-6 text-sm text-gray-500">No media yet. Upload a video to get started.</p>;
  }

  return (
    <>
      <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={onRetryFile} />
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="asset-grid">
        {assets.map((a) => {
          const Icon = KIND_ICON[a.kind];
          return (
            <div key={a.id} className="flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
              <div className="relative flex aspect-video items-center justify-center bg-navy/5">
                {a.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.posterUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Icon className="h-8 w-8 text-navy/30" />
                )}
                {a.durationMs ? (
                  <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
                    {fmtDuration(a.durationMs)}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-1 flex-col gap-2 p-3">
                <span className="truncate text-sm font-medium text-navy" title={a.title}>
                  {a.title}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={a.status} />
                  {retrying === a.id ? (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Transcribing…
                    </span>
                  ) : (
                    <TranscriptBadge status={a.transcriptionStatus} />
                  )}
                </div>
                <div className="mt-auto flex justify-end gap-1">
                  {a.transcriptionStatus === "completed" ? (
                    <a
                      href={`/api/ocia/assets/${a.id}/transcript`}
                      title="Download transcript"
                      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-navy"
                    >
                      <Download className="h-4 w-4" />
                    </a>
                  ) : null}
                  {a.kind === "video" &&
                  a.transcriptionStatus !== "pending" &&
                  a.transcriptionStatus !== "processing" ? (
                    <button
                      onClick={() => startRetry(a.id)}
                      disabled={retrying === a.id}
                      title={
                        a.transcriptionStatus === "completed"
                          ? "Re-transcribe (re-select the video file)"
                          : a.transcriptionStatus === "failed"
                            ? "Retry transcription (re-select the video file)"
                            : "Generate transcript (re-select the video file)"
                      }
                      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gold-dark disabled:opacity-50"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  ) : null}
                  <button
                    onClick={() => {
                      if (!window.confirm(`Delete "${a.title}"?`)) return;
                      setDeleting(a.id);
                      startTransition(async () => {
                        await deleteAssetAction(a.id);
                        setDeleting(null);
                        router.refresh();
                      });
                    }}
                    disabled={deleting === a.id}
                    aria-label="Delete"
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-rose disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
