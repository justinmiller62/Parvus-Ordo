"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { getScriptAction, markReadyAction, saveScriptAction, startAiSessionAction } from "./actions";

const STATUS_LABEL: Record<string, string> = {
  drafting: "Drafting",
  ready_to_record: "Ready to record",
  submitted: "Submitted — awaiting review",
  approved: "Approved",
  rejected: "Rejected",
};

function wordCount(t: string) {
  const s = t.trim();
  return s ? s.split(/\s+/).length : 0;
}

export function YouthProjectClient({
  projectId,
  initialScript,
  initialStatus,
  recordingUrl,
}: {
  projectId: string;
  initialScript: string;
  initialStatus: string;
  recordingUrl: string | null;
}) {
  const [script, setScript] = useState(initialScript);
  const [status, setStatus] = useState(initialStatus);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const editing = useRef(false);
  const scriptRef = useRef(initialScript);
  scriptRef.current = script;

  // Live update: every 3s, pull the server script. If Claude wrote a new draft (and
  // the teen isn't actively typing), sync it into the editor.
  useEffect(() => {
    const iv = setInterval(async () => {
      const r = await getScriptAction(projectId);
      setStatus(r.status);
      if (!editing.current && r.fullText !== scriptRef.current) setScript(r.fullText);
    }, 3000);
    return () => clearInterval(iv);
  }, [projectId]);

  const words = wordCount(script);
  const seconds = Math.round((words / 150) * 60);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded bg-navy/10 px-2 py-1 text-xs font-medium text-navy" data-testid="yt-status">
          {STATUS_LABEL[status] ?? status}
        </span>
        <span className="text-xs text-gray-500" data-testid="yt-wordcount">
          {words} words · ~{seconds}s
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="yt-start-session"
          onClick={() =>
            startTransition(async () => {
              const r = await startAiSessionAction();
              setToken(r.token);
            })
          }
          className="rounded-md bg-burgundy px-3 py-1.5 text-sm font-medium text-cream hover:bg-rose disabled:opacity-50"
          disabled={pending}
        >
          Start AI session
        </button>
        {status === "drafting" ? (
          <button
            type="button"
            data-testid="yt-mark-ready"
            onClick={() => startTransition(() => markReadyAction(projectId))}
            className="rounded-md border border-gold bg-gold/10 px-3 py-1.5 text-sm font-medium text-gold-dark hover:bg-gold/20 disabled:opacity-50"
            disabled={pending}
          >
            Mark ready to record
          </button>
        ) : null}
      </div>

      {token ? (
        <div className="rounded-md border border-navy/15 bg-cream/40 p-3 text-sm" data-testid="yt-token">
          <p className="mb-1 font-medium text-navy">MCP session token (paste into Claude Desktop):</p>
          <code className="block break-all rounded bg-white px-2 py-1 text-xs text-navy">{token}</code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(token);
              setCopied(true);
            }}
            className="mt-2 text-xs text-burgundy hover:underline"
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>
        </div>
      ) : null}

      <div>
        <label className="mb-1 block text-sm font-medium text-navy" htmlFor="yt-script">
          Script
        </label>
        <textarea
          id="yt-script"
          data-testid="yt-script"
          value={script}
          onChange={(e) => setScript(e.target.value)}
          onFocus={() => {
            editing.current = true;
          }}
          onBlur={() => {
            editing.current = false;
            void saveScriptAction(projectId, script);
          }}
          rows={12}
          placeholder="Your script will appear here as Claude writes it — or type your own."
          className="w-full rounded-md border border-navy/15 bg-white p-3 text-sm text-navy focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
        />
      </div>

      {recordingUrl ? (
        <div data-testid="yt-recording">
          <p className="mb-1 text-sm font-medium text-navy">Recording</p>
          <iframe
            src={recordingUrl}
            className="aspect-video w-full rounded-md border border-navy/15"
            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            title="Parvus Studio recording"
          />
        </div>
      ) : null}
    </div>
  );
}
