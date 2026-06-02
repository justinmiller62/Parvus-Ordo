"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createCohort } from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";

// Creating (and deleting) a cohort is admin-only; catechists manage existing cohorts.
async function adminCtx(): Promise<{ parishId: string }> {
  const v = await getViewer();
  const role = v?.identity?.role;
  if (!v?.identity?.parishId || !(role === "admin" || role === "super_admin")) redirect("/");
  return { parishId: v.identity.parishId };
}

/** Create a cohort by name (blank names are rejected in core). */
export async function createCohortAction(name: string): Promise<void> {
  const { parishId } = await adminCtx();
  await createCohort(parishId, name);
  revalidatePath("/ocia/cohorts");
}
