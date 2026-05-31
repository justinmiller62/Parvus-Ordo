import type { BrandTokens } from "@parvaordo/shared";

/**
 * The default Parvus Ordo brand. Palette derived from the brand logo:
 * burgundy wordmark, gold ring, charcoal-navy chapel, cream/parchment ground,
 * deep-rose roses. Headings in Cinzel, body in Inter.
 */
export const DEFAULT_BRAND: BrandTokens = {
  name: "Parvus Ordo",
  logoSrc: "/logo.jpg",
  tagline: "Many small things, rightly ordered.",
  colors: {
    burgundy: "#6E1423",
    gold: "#C9A84C",
    navy: "#2C3347",
    cream: "#F5ECD7",
    parchment: "#FAF8F2",
    rose: "#8B2942",
  },
  fonts: {
    heading: "var(--font-cinzel), Georgia, serif",
    body: "var(--font-inter), system-ui, sans-serif",
  },
};

/**
 * Resolve brand tokens for a request hostname.
 *
 * Cascade (most specific wins): default Parvus Ordo -> diocese -> parish.
 * STUB: always returns the default brand. When the parishes/dioceses tables
 * exist, this looks up the hostname (Workers KV) -> parish/diocese -> merges
 * their stored brand overrides onto DEFAULT_BRAND. This is the single chokepoint
 * for branding so per-parish/diocese theming is not bolted on later.
 */
export function resolveBrand(_hostname: string | null): BrandTokens {
  return DEFAULT_BRAND;
}
