import { getDb } from "../db/client";

/** A request hostname resolves to one of: the apex (no parish), a parish slug
 * (subdomain), or a custom domain. */
export type ParishRef = { kind: "apex" } | { kind: "slug"; slug: string } | { kind: "custom"; domain: string };

/** Leftmost labels that map to the apex (marketing/login), never a parish slug. */
const RESERVED_LABELS = new Set(["www", "app"]);

/**
 * Resolve a request `Host` to a parish reference, given the environment's base
 * domain (PARISH_BASE_DOMAIN). Pure + testable — no DB, no env.
 *
 *   base "parvusordo.com"
 *     parvusordo.com               -> { apex }
 *     www.parvusordo.com           -> { apex }
 *     holy-spirit.parvusordo.com   -> { slug: "holy-spirit" }
 *     holyspiritlockhaven.org      -> { custom: "holyspiritlockhaven.org" }
 *   base "localhost"
 *     localhost:3000               -> { apex }
 *     holy-spirit.localhost:3000   -> { slug: "holy-spirit" }
 */
export function resolveParishRef(host: string | null, baseDomain: string): ParishRef {
  if (!host) return { kind: "apex" };
  const h = host.split(":")[0]!.trim().toLowerCase().replace(/\.$/, ""); // drop port + trailing dot
  const base = baseDomain.trim().toLowerCase().replace(/\.$/, "");
  if (!h || h === base) return { kind: "apex" };
  if (base && h.endsWith("." + base)) {
    const label = h.slice(0, h.length - base.length - 1);
    // Only a single leftmost label is a slug; deeper sub-subdomains aren't parishes.
    if (!label || label.includes(".") || RESERVED_LABELS.has(label)) return { kind: "apex" };
    return { kind: "slug", slug: label };
  }
  return { kind: "custom", domain: h };
}

/** The base domain for parish subdomains in this environment (PARISH_BASE_DOMAIN). */
export function parishBaseDomain(): string {
  return (process.env.PARISH_BASE_DOMAIN ?? "localhost").trim().toLowerCase();
}

// The host→parishId map is global routing data: resolve_parish_id is a pre-tenant-
// context SECURITY DEFINER lookup that returns the same id for a given slug/custom
// domain regardless of viewer, and it changes only when a parish is provisioned or
// re-domained. getViewer resolves it on EVERY authenticated request, so without a cache
// each navigation spends a connection-acquire + BEGIN/COMMIT just to map a host. We
// cache the resolution process-locally with a short TTL. This holds only public routing
// info — never per-parish state — so it's rebuildable, not authoritative tenant state
// (within the statelessness rules). The provisioning path calls invalidateParishHostCache();
// the TTL is the backstop. Only *positive* resolutions are cached, which keeps the map
// bounded by the provisioned hosts and lets a newly provisioned parish resolve at once
// (no negative entry to wait out). (po-6ei)

/** Backstop TTL for the cached host→parishId map, in ms. Provisioning should invalidate
 * explicitly; this bounds staleness when an out-of-process change doesn't. */
export const PARISH_HOST_CACHE_TTL_MS = 5 * 60 * 1000;

const hostParishCache = new Map<string, { parishId: string; expiresAt: number }>();

/** Drop the cached host→parishId map so the next resolve re-reads it. Call from the
 * parish provisioning / re-domain path after changing a slug or custom domain. */
export function invalidateParishHostCache(): void {
  hostParishCache.clear();
}

/**
 * Resolve a request hostname to a parish id via the resolve_parish_id SECURITY
 * DEFINER function (cross-tenant, pre-tenant-context). Returns null for the apex
 * or an unknown host. Subdomain → by slug; otherwise → by custom_domains. Positive
 * results are served from a process-local TTL cache (see above); `nowMs` is injectable
 * for tests.
 */
export async function resolveParishIdForHost(host: string | null, nowMs: number = Date.now()): Promise<string | null> {
  const ref = resolveParishRef(host, parishBaseDomain());
  if (ref.kind === "apex") return null;
  const slug = ref.kind === "slug" ? ref.slug : null;
  const domain = ref.kind === "custom" ? ref.domain : null;
  const key = ref.kind === "slug" ? `slug:${ref.slug}` : `custom:${ref.domain}`;

  const hit = hostParishCache.get(key);
  if (hit && nowMs < hit.expiresAt) return hit.parishId;

  const { rows } = await getDb(null).query<{ id: string | null }>("SELECT resolve_parish_id($1, $2) AS id", [
    slug,
    domain,
  ]);
  const parishId = rows[0]?.id ?? null;
  if (parishId) hostParishCache.set(key, { parishId, expiresAt: nowMs + PARISH_HOST_CACHE_TTL_MS });
  return parishId;
}
