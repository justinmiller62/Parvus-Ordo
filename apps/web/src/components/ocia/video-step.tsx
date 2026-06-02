"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Lock } from "lucide-react";
import { VideoPlayer, type PlayerWord } from "./video-player";
import { advanceAction } from "@/app/(app)/ocia/lessons/[id]/actions";

const BACK_BTN =
  "inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-parchment";
const PRIMARY_BTN =
  "inline-flex items-center gap-2 rounded-md bg-gold px-5 py-2.5 text-sm font-medium text-white hover:bg-gold-dark disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Active student video step: the seek-enforcing player plus a Continue button that
 * stays locked until the clip has been watched (the player flips `watched` during
 * the last 5s, retrying the completion save each tick). Persists watch progress so
 * resume + enforcement survive reloads.
 */
export function VideoStep({
  src,
  startMs,
  endMs,
  words,
  itemId,
  lessonId,
  step,
  initialMaxReachedMs,
  backHref,
}: {
  src: string;
  startMs: number;
  endMs: number | null;
  words: PlayerWord[];
  itemId: string;
  lessonId: string;
  step: number;
  initialMaxReachedMs: number;
  backHref?: string;
}) {
  const [watched, setWatched] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const fd = new FormData();
    fd.set("lessonId", lessonId);
    fd.set("itemId", itemId);
    fd.set("kind", "video");
    fd.set("step", String(step));
    startTransition(() => {
      void advanceAction(fd);
    });
  };

  return (
    <>
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <VideoPlayer
          src={src}
          startMs={startMs}
          endMs={endMs}
          words={words}
          persistItemId={itemId}
          initialMaxReachedMs={initialMaxReachedMs}
          onWatched={() => setWatched(true)}
        />
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-gray-200 pt-4">
        {backHref ? (
          <Link href={backHref} className={BACK_BTN} data-testid="wizard-back">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!watched || pending}
          data-testid="wizard-next"
          className={PRIMARY_BTN}
        >
          {watched ? "Continue" : "Watch to continue"}
          {watched ? <ArrowRight className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
        </button>
      </div>
    </>
  );
}
