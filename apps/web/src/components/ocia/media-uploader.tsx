"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as tus from "tus-js-client";
import { Upload } from "lucide-react";
import type { UploadTarget } from "@parvaordo/core";
import { extractAudioWav } from "@/src/lib/audio-extract";
import {
  createVideoUploadAction,
  deleteAssetAction,
  markUploadedAction,
  pollStatusAction,
} from "@/app/(app)/ocia/media/actions";
import { UploadProgress, type Stage, type StageState } from "./upload-progress";

const INITIAL: Stage[] = [
  { key: "upload", label: "Upload", state: "pending" },
  { key: "transcode", label: "Transcode", state: "pending" },
  { key: "transcribe", label: "Transcribe", state: "pending" },
  { key: "ready", label: "Ready", state: "pending" },
];

function tusUpload(
  file: File,
  target: Extract<UploadTarget, { kind: "tus" }>,
  onPct: (p: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const up = new tus.Upload(file, {
      endpoint: target.endpoint,
      retryDelays: [0, 3000, 6000],
      headers: {
        AuthorizationSignature: target.signature,
        AuthorizationExpire: String(target.expires),
        VideoId: target.videoId,
        LibraryId: target.libraryId,
      },
      metadata: { filetype: file.type, title: file.name },
      onError: reject,
      onProgress: (sent, total) => onPct((sent / total) * 100),
      onSuccess: () => resolve(),
    });
    up.start();
  });
}

export function MediaUploader() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [stages, setStages] = useState<Stage[]>(INITIAL);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: string, state: StageState, pct?: number) =>
    setStages((prev) => prev.map((s) => (s.key === key ? { ...s, state, pct } : s)));

  async function run(file: File) {
    setRunning(true);
    setError(null);
    setStages(INITIAL.map((s) => (s.key === "upload" ? { ...s, state: "active", pct: 0 } : s)));
    let createdAssetId: string | undefined;
    try {
      const { assetId, target } = await createVideoUploadAction(file.name);
      createdAssetId = assetId;

      // 1) Upload bytes to the host (or skip for the local stub).
      if (target.kind === "tus") {
        await tusUpload(file, target, (p) => set("upload", "active", p));
      }
      set("upload", "done");
      await markUploadedAction(assetId);

      // 2) Transcode (poll the host) and 3) Transcribe (local audio → Groq) run in parallel.
      set("transcode", "active", target.kind === "stub" ? 100 : 0);
      set("transcribe", "active");

      const transcode = (async () => {
        for (;;) {
          const s = await pollStatusAction(assetId);
          set("transcode", s.status === "ready" ? "done" : s.status === "failed" ? "error" : "active", s.progress);
          if (s.status === "ready") return;
          if (s.status === "failed") throw new Error("Transcoding failed");
          await new Promise((r) => setTimeout(r, 3000));
        }
      })();

      const transcribe = (async () => {
        const wav = await extractAudioWav(file);
        const res = await fetch(`/api/ocia/transcribe/${assetId}`, {
          method: "POST",
          headers: { "Content-Type": "audio/wav" },
          body: wav,
        });
        if (!res.ok) throw new Error("Transcription failed");
        set("transcribe", "done");
      })();

      await Promise.all([transcode, transcribe]);
      set("ready", "done");
      setTimeout(() => {
        setRunning(false);
        setStages(INITIAL);
        router.refresh();
      }, 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setStages((prev) => prev.map((s) => (s.state === "active" ? { ...s, state: "error" } : s)));
      // Don't leave an orphaned asset row behind if upload/transcode failed.
      if (createdAssetId) await deleteAssetAction(createdAssetId).catch(() => {});
      setRunning(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        data-testid="media-file-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void run(f);
          e.target.value = "";
        }}
      />
      {running ? (
        <UploadProgress stages={stages} />
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          data-testid="media-upload-btn"
          className="flex w-full items-center justify-center gap-2 rounded-md border-2 border-dashed border-gray-300 px-4 py-6 text-sm font-medium text-gray-600 hover:border-gold hover:bg-parchment"
        >
          <Upload className="h-5 w-5" />
          Upload a video
        </button>
      )}
      {error ? <p className="mt-2 text-sm text-rose">{error}</p> : null}
    </div>
  );
}
