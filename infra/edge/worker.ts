import { Container, getContainer } from "@cloudflare/containers";

// Bindings available to the Worker (wrangler.jsonc `vars` + secrets uploaded by CI).
interface Env {
  WEB_CONTAINER: DurableObjectNamespace;
  // runtime config forwarded into the Next container
  DATABASE_URL: string;
  WORKOS_CLIENT_ID: string;
  WORKOS_API_KEY: string;
  WORKOS_COOKIE_PASSWORD: string;
  // Dedicated signing secret for app-issued /api/v1 bearer tokens (po-u79). Optional:
  // core/auth/api-token falls back to WORKOS_COOKIE_PASSWORD until this is provisioned.
  API_TOKEN_SECRET?: string;
  WORKOS_REDIRECT_URI: string;
  NEXT_PUBLIC_WORKOS_REDIRECT_URI: string;
  PARISH_BASE_DOMAIN: string;
  BUNNY_STREAM_LIBRARY_ID: string;
  BUNNY_STREAM_LIBRARY_KEY: string;
  BUNNY_STREAM_CDN_HOSTNAME: string;
  GROQ_API_KEY: string;
  CLIP_CALLBACK_SECRET?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_SLIDES_BUCKET?: string;
}

/**
 * The Next 16 app runs inside this container (`next start` on :3000). The Worker
 * is the origin's front door; runtime config/secrets are bound to the Worker and
 * forwarded into the container process here. Edge caching (Cache API) is layered
 * in front of this in a later step.
 */
export class WebContainer extends Container<Env> {
  defaultPort = 3000; // matches PORT in the Dockerfile
  sleepAfter = "5m"; // dev: scale to zero quickly to minimize idle cost; raise for prod

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      NODE_ENV: "production",
      PORT: "3000",
      HOSTNAME: "0.0.0.0",
      DATABASE_URL: env.DATABASE_URL,
      WORKOS_CLIENT_ID: env.WORKOS_CLIENT_ID,
      WORKOS_API_KEY: env.WORKOS_API_KEY,
      WORKOS_COOKIE_PASSWORD: env.WORKOS_COOKIE_PASSWORD,
      WORKOS_REDIRECT_URI: env.WORKOS_REDIRECT_URI,
      NEXT_PUBLIC_WORKOS_REDIRECT_URI: env.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
      PARISH_BASE_DOMAIN: env.PARISH_BASE_DOMAIN,
      BUNNY_STREAM_LIBRARY_ID: env.BUNNY_STREAM_LIBRARY_ID,
      BUNNY_STREAM_LIBRARY_KEY: env.BUNNY_STREAM_LIBRARY_KEY,
      BUNNY_STREAM_CDN_HOSTNAME: env.BUNNY_STREAM_CDN_HOSTNAME,
      GROQ_API_KEY: env.GROQ_API_KEY,
      ...(env.API_TOKEN_SECRET ? { API_TOKEN_SECRET: env.API_TOKEN_SECRET } : {}),
      ...(env.CLIP_CALLBACK_SECRET ? { CLIP_CALLBACK_SECRET: env.CLIP_CALLBACK_SECRET } : {}),
      ...(env.R2_ACCOUNT_ID ? { R2_ACCOUNT_ID: env.R2_ACCOUNT_ID } : {}),
      ...(env.R2_ACCESS_KEY_ID ? { R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID } : {}),
      ...(env.R2_SECRET_ACCESS_KEY ? { R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY } : {}),
      ...(env.R2_SLIDES_BUCKET ? { R2_SLIDES_BUCKET: env.R2_SLIDES_BUCKET } : {}),
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // One logical app → a single container instance for now. The edge cache (added
    // next) serves most public/CMS traffic without touching the container; scale
    // across instances with getRandom(env.WEB_CONTAINER, N) when concurrency grows.
    const container = getContainer(env.WEB_CONTAINER);
    const res = await container.fetch(request);

    // The container is reached at its internal address, so Next inside sees
    // Host 0.0.0.0:3000 and can emit redirects (e.g. post-login) to that internal
    // origin. Rewrite any such Location back to the public origin the Worker sees.
    const location = res.headers.get("location");
    if (location && location.includes("0.0.0.0:3000")) {
      const publicOrigin = new URL(request.url).origin;
      const fixed = new Response(res.body, res);
      fixed.headers.set("location", location.replace(/https?:\/\/0\.0\.0\.0:3000/g, publicOrigin));
      return fixed;
    }
    return res;
  },
};
