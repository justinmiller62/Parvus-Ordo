"use server";

import { revalidatePath } from "next/cache";
import { createCohort } from "@parvaordo/core";
import { requireAdmin } from "@/src/lib/require-role";

// Creating (and deleting) a cohort is admin-only; catechists manage existing cohorts.
/** Create a cohort by name (blank names are rejected in core). */
export async function createCohortAction(name: string): Promise<void> {
  const { parishId } = await requireAdmin("/", "ocia");
  await createCohort(parishId, name);
  revalidatePath("/ocia/cohorts");
}
