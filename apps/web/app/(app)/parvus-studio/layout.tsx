import type { ReactNode } from "react";
import { requireModule } from "@/src/lib/require-role";

// Gate the whole Parvus Studio module: it must be ENABLED for the parish (RFC-001 §3.5 — a
// disabled module redirects home for deep links AND top-level entry). Role eligibility for
// studio stays enforced per-page and per-action; this route-group layout adds the module gate.
export default async function ParvusStudioLayout({ children }: { children: ReactNode }) {
  await requireModule("studio");
  return <>{children}</>;
}
