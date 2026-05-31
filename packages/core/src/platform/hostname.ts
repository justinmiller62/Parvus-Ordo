import { getDb } from "../db/client";

/** A request hostname resolves to one of: the apex (no parish), a parish slug
 * (subdomain), or a custom domain. */
export type ParishRef =
  | { kind: "apex" }
  | { kind: "slug"; slug: string }
  | { kind: "custom"; domain: string };

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

/**
 * Resolve a request hostname to a parish id via the resolve_parish_id SECURITY
 * DEFINER function (cross-tenant, pre-tenant-context). Returns null for the apex
 * or an unknown host. Subdomain → by slug; otherwise → by custom_domains.
 */
export async function resolveParishIdForHost(host: string | null): Promise<string | null> {
  const ref = resolveParishRef(host, parishBaseDomain());
  if (ref.kind === "apex") return null;
  const slug = ref.kind === "slug" ? ref.slug : null;
  const domain = ref.kind === "custom" ? ref.domain : null;
  const { rows } = await getDb(null).query<{ id: string | null }>(
    "SELECT resolve_parish_id($1, $2) AS id",
    [slug, domain],
  );
  return rows[0]?.id ?? null;
}
