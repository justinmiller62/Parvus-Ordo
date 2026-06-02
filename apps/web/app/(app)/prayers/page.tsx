import { isStaff } from "@parvaordo/shared";
import { redirect } from "next/navigation";
import { listPrayers } from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";
import { PrayersClient } from "./prayers-client";

// /prayers — Prayer Book. All members read; catechist/admin add prayers (submissions)
// and override universal prayers. (Rosary Guide is a separate static asset, deferred.)
export default async function PrayersPage() {
  const viewer = await getViewer();
  if (!viewer?.identity?.parishId) redirect("/login");
  const role = viewer.identity.role;
  const canEdit = isStaff(role);
  const prayers = await listPrayers(viewer.identity.parishId);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-gray-400">OCIA › Reference</p>
        <h1 className="font-heading text-2xl text-navy">Prayer Book</h1>
      </div>
      <PrayersClient prayers={prayers} canEdit={canEdit} />
    </div>
  );
}
