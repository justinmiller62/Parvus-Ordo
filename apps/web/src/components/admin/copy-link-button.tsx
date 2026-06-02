"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Copy a string to the clipboard with brief inline "Copied" feedback. Falls back silently when
 *  the Clipboard API is unavailable (e.g. insecure context). */
export function CopyLinkButton({ value, label = "Copy setup link" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* clipboard unavailable — no-op */
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-gold/40 bg-gold/10 px-2.5 py-1 text-xs font-medium text-gold-dark transition-colors hover:bg-gold/20"
      aria-label={`${label} (${value})`}
    >
      {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      {copied ? "Copied" : label}
    </button>
  );
}
