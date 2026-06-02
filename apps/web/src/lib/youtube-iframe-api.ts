// Shared YouTube IFrame Player API loader + minimal typings (we don't depend on
// @types/youtube). Used by BOTH the seek-enforcing student `YouTubePlayer` and the
// editor `YouTubeTrimmer` — a `<video>` element can't drive a YouTube embed, so each
// constructs a `YT.Player`. The loader injects the API script once per page and the
// `window.YT?.Player` guard makes concurrent callers (player + trimmer) share it.

export interface YTPlayer {
  getCurrentTime(): number;
  getDuration(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
}

export interface YTPlayerEvent {
  target: YTPlayer;
  data?: number;
}

export interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      host?: string;
      playerVars?: Record<string, unknown>;
      events?: { onReady?: (e: YTPlayerEvent) => void; onStateChange?: (e: YTPlayerEvent) => void };
    },
  ) => YTPlayer;
  PlayerState: { PLAYING: number; ENDED: number };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

// Load the IFrame API script once per page and resolve when YT.Player is constructable.
let ytApiPromise: Promise<void> | null = null;

export function loadYouTubeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise<void>((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return ytApiPromise;
}
