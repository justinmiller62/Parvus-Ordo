import { isStaff } from "@parvaordo/shared";
import { redirect } from "next/navigation";
import { listDictionary } from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";
import { DictionaryClient } from "./dictionary-client";

// /dictionary — Catholic glossary. All members read; catechist/admin can add terms
// (parish submissions) and override universal entries.
export default async function DictionaryPage() {
  const viewer = await getViewer();
  if (!viewer?.identity?.parishId) redirect("/login");
  const role = viewer.identity.role;
  const canEdit = isStaff(role);
  const entries = await listDictionary(viewer.identity.parishId);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-gray-400">Reference</p>
        <h1 className="font-heading text-2xl text-navy">Dictionary</h1>
      </div>
      <DictionaryClient entries={entries} canEdit={canEdit} />
    </div>
  );
}
