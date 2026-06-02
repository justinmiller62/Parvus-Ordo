import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getViewer } from "@/src/lib/viewer";
import { requireModule } from "@/src/lib/require-role";

// Gate the whole OCIA module: it must be ENABLED for the parish (RFC-001 §3.5 — a disabled
// module redirects home, deep link AND top-level), and only OCIA roles may enter;
// parish_member is sent back to the parish dashboard.
export default async function OciaLayout({ children }: { children: ReactNode }) {
  await requireModule("ocia");
  const viewer = await getViewer();
  const role = viewer?.identity?.role ?? null;
  const eligible =
    role === "admin" || role === "catechist" || role === "catechumen_candidate" || role === "super_admin";
  if (!eligible) redirect("/");
  return <>{children}</>;
}
