import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getViewer } from "@/src/lib/viewer";

// Gate the whole OCIA module: only OCIA roles may enter; parish_member is sent
// back to the parish dashboard.
export default async function OciaLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewer();
  const role = viewer?.identity?.role ?? null;
  const eligible =
    role === "admin" || role === "catechist" || role === "catechumen_candidate" || role === "super_admin";
  if (!eligible) redirect("/");
  return <>{children}</>;
}
