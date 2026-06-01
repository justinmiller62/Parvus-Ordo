"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const MAX_MB = 12;

type Status =
  | { kind: "idle" }
  | { kind: "uploading"; pct: number }
  | { kind: "done" }
  | { kind: "error"; msg: string };

// Slide upload with a real progress bar — XHR to the route handler (Server Actions
// can't report upload progress). Validates size/type client-side too for instant feedback.
export function SlideUploadForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [order, setOrder] = useState(1);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return setStatus({ kind: "error", msg: "Choose an image to upload." });
    if (!file.type.startsWith("image/")) return setStatus({ kind: "error", msg: "Slide must be an image (PNG or JPG)." });
    if (file.size > MAX_MB * 1024 * 1024) {
      return setStatus({ kind: "error", msg: `Slide is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ${MAX_MB} MB.` });
    }

    const fd = new FormData();
    fd.append("file", file);
    fd.append("slide_order", String(order));

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/parvus-studio/projects/${projectId}/slides`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setStatus({ kind: "uploading", pct: Math.round((e.loaded / e.total) * 100) });
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setStatus({ kind: "done" });
        if (fileRef.current) fileRef.current.value = "";
        router.refresh(); // show the new slide
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
  const inputClass = "rounded-md border border-navy/15 bg-white px-2 py-1.5 text-sm text-navy disabled:opacity-50";

  return (
    <div className="space-y-2" data-testid="yt-slide-upload">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={order}
          onChange={(e) => setOrder(Number(e.target.value))}
          disabled={uploading}
          className={inputClass}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>Slide {n}</option>
          ))}
        </select>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg"
          disabled={uploading}
          onChange={() => setStatus({ kind: "idle" })}
          className="text-sm text-navy"
        />
        <button
          type="button"
          onClick={upload}
          disabled={uploading}
          data-testid="yt-slide-upload-btn"
          className="rounded-md bg-burgundy px-3 py-1.5 text-sm font-medium text-cream hover:bg-rose disabled:opacity-50"
        >
          {uploading ? `Uploading… ${status.pct}%` : "Upload slide"}
        </button>
      </div>

      {uploading ? (
        <div className="h-1.5 w-full overflow-hidden rounded bg-navy/10" role="progressbar" aria-valuenow={status.pct}>
          <div className="h-full bg-gold transition-[width] duration-150" style={{ width: `${status.pct}%` }} />
        </div>
      ) : null}
      {status.kind === "error" ? <p className="text-sm text-rose" data-testid="slide-error">{status.msg}</p> : null}
      {status.kind === "done" ? <p className="text-sm text-green-700" data-testid="slide-done">Uploaded ✓</p> : null}
    </div>
  );
}
