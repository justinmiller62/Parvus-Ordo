"use client";

import { Check, Loader2, X } from "lucide-react";

export type StageState = "pending" | "active" | "done" | "error";
export interface Stage {
  key: string;
  label: string;
  state: StageState;
  /** 0–100 for the active stage; omit for indeterminate. */
  pct?: number;
}

/**
 * The multi-stage upload bar: Upload → Transcode → Transcribe → Ready. Vertical so
 * it reads cleanly on mobile. Each stage shows its own state; the active stage gets
 * a progress bar (determinate when we have a percent, indeterminate otherwise).
 */
export function UploadProgress({ stages }: { stages: Stage[] }) {
  return (
    <ol className="space-y-2.5" data-testid="upload-progress">
      {stages.map((s) => (
        <li key={s.key} className="flex items-center gap-3">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
              s.state === "done"
                ? "bg-gold text-white"
                : s.state === "error"
                  ? "bg-rose/15 text-rose"
                  : s.state === "active"
                    ? "bg-navy text-white"
                    : "bg-gray-100 text-gray-400"
            }`}
          >
            {s.state === "done" ? (
              <Check className="h-3.5 w-3.5" />
            ) : s.state === "error" ? (
              <X className="h-3.5 w-3.5" />
            ) : s.state === "active" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              "•"
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <span className={`text-sm ${s.state === "pending" ? "text-gray-400" : "text-navy"}`}>{s.label}</span>
              {s.state === "active" && s.pct != null ? (
                <span className="text-xs text-gray-400">{Math.round(s.pct)}%</span>
              ) : null}
            </div>
            {s.state === "active" ? (
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                <div
                  className={`h-1.5 rounded-full bg-gold transition-all ${s.pct == null ? "w-1/3 animate-pulse" : ""}`}
                  style={s.pct != null ? { width: `${s.pct}%` } : undefined}
                />
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
