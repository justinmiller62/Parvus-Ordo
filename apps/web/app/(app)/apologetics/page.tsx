import { redirect } from "next/navigation";
import { listApologetics } from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";
import { requireModule } from "@/src/lib/require-role";
import { ApologeticsClient } from "./apologetics-client";

// /apologetics — objection → reply → citations, from the global "To Whom Shall We Go"
// corpus. Read-only in v1: every parish role reads, nobody edits in-app (the
// apologetics_overrides table ships with 0033 but has no write path yet).
//
// `apologetics` is a TOGGLEABLE module shipping dark, so this gates on requireModule
// (RFC-001 §3.5 layer-2: nav hiding is not enforcement).
export default async function ApologeticsPage() {
  await requireModule("apologetics");
  const viewer = await getViewer();
  if (!viewer?.identity?.parishId) redirect("/login");
  const topics = await listApologetics(viewer.identity.parishId);

  return <ApologeticsClient topics={topics} />;
}
