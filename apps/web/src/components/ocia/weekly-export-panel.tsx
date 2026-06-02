"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ClipboardCopy } from "lucide-react";

/**
 * The interactive half of the Weekly Export page: a live Markdown preview and a
 * one-click "Copy Export" button. The Markdown is rendered server-side (RSC) and
 * passed in whole, so this component owns only the copy interaction — matching the
 * Narthex single-button flow. "Copied!" reverts after 2s.
 */
export function WeeklyExportPanel({ markdown }: { markdown: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => clearTimer(), []);
  function clearTimer() {
    if (timer.current) clearTimeout(timer.current);
  }

  async function handleCopy() {
    clearTimer();
    try {
      await navigator.clipboard.writeText(markdown);
      setFailed(false);
      setCopied(true);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (permissions / insecure context): tell the user to copy
      // manually rather than silently doing nothing.
      setCopied(false);
      setFailed(true);
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="font-heading text-lg text-navy">Export preview</h2>
        <button
          type="button"
          onClick={handleCopy}
          data-testid="copy-export"
          aria-live="polite"
          className={`inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium text-white shadow-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-gold focus:ring-offset-1 ${
            copied ? "bg-green-600" : "bg-gold hover:bg-gold-dark active:scale-[0.98]"
          }`}
        >
          {copied ? (
            <>
              <Check className="h-4 w-4 motion-safe:animate-[po-fade-in_150ms_ease-out]" />
              Copied!
            </>
          ) : (
            <>
              <ClipboardCopy className="h-4 w-4" />
              Copy Export
            </>
          )}
        </button>
      </div>

      {failed ? (
        <p className="mb-2 text-xs text-rose" data-testid="copy-failed">
          Couldn&apos;t access the clipboard — select the text below and copy manually.
        </p>
      ) : null}

      <pre
        data-testid="export-preview"
        className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-cream/40 p-4 font-mono text-xs leading-relaxed text-navy"
      >
        {markdown}
      </pre>
    </div>
  );
}
