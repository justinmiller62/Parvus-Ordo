import { Container, getContainer } from "@cloudflare/containers";

// Bindings available to the Worker (wrangler.jsonc `vars` + secrets uploaded by CI).
interface Env {
  WEB_CONTAINER: DurableObjectNamespace;
  // runtime config forwarded into the Next container
  DATABASE_URL: string;
  WORKOS_CLIENT_ID: string;
  WORKOS_API_KEY: string;
  WORKOS_COOKIE_PASSWORD: string;
  WORKOS_REDIRECT_URI: string;
  PARISH_BASE_DOMAIN: string;
  BUNNY_STREAM_LIBRARY_ID: string;
  BUNNY_STREAM_LIBRARY_KEY: string;
  BUNNY_STREAM_CDN_HOSTNAME: string;
  GROQ_API_KEY: string;
  CLIP_CALLBACK_SECRET?: string;
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
      PARISH_BASE_DOMAIN: env.PARISH_BASE_DOMAIN,
      BUNNY_STREAM_LIBRARY_ID: env.BUNNY_STREAM_LIBRARY_ID,
      BUNNY_STREAM_LIBRARY_KEY: env.BUNNY_STREAM_LIBRARY_KEY,
      BUNNY_STREAM_CDN_HOSTNAME: env.BUNNY_STREAM_CDN_HOSTNAME,
      GROQ_API_KEY: env.GROQ_API_KEY,
      ...(env.CLIP_CALLBACK_SECRET ? { CLIP_CALLBACK_SECRET: env.CLIP_CALLBACK_SECRET } : {}),
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // One logical app → a single container instance for now. The edge cache (added
    // next) serves most public/CMS traffic without touching the container; scale
    // across instances with getRandom(env.WEB_CONTAINER, N) when concurrency grows.
    const container = getContainer(env.WEB_CONTAINER);
    return container.fetch(request);
  },
};
