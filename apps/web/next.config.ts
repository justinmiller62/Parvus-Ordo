import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (.next/standalone) for a lean container image.
  output: "standalone",
  // Workspace packages ship TypeScript source; let Next compile them.
  transpilePackages: ["@parvaordo/core", "@parvaordo/shared"],
  // `pg` is a Node driver — keep it external to server bundles, not bundled.
  serverExternalPackages: ["pg"],
  experimental: {
    // The proxy buffers request bodies (default 10MB) — too small for browser-
    // extracted audio (16kHz mono ≈ 1.9MB/min, so ~19MB for a 10-min video). Raise
    // it for the /api/ocia/transcribe upload. (Prod moves transcription out-of-band.)
    proxyClientMaxBodySize: "128mb",
  },
};

export default nextConfig;
