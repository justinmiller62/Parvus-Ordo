"use server";

import { revalidatePath } from "next/cache";
import { type CalendarSourceInput, createSource, deleteSource, setSourceEnabled, updateSource } from "@parvaordo/core";
import { requireStaff } from "@/src/lib/require-role";

// calendar_sources (external iCal feeds) CRUD. Editor-only per the spec — catechist + admin
// both manage feeds, so all gate on requireStaff (the server-side backstop behind the
// editor-gated Manage Feeds page). Core's validate() enforces the real shape (name 1–200,
// https URL 12–2048, hex color); these friendly checks mirror the modal's submit gate so a
// blank field returns a readable error instead of a raw core throw. The host whitelist is
// applied at FETCH time, so a feed can be staged before its host is allow-listed.

function assertValid(input: CalendarSourceInput): void {
  if (!input.name?.trim()) throw new Error("Feed name is required");
  if (!input.url?.trim()) throw new Error("Feed URL is required");
}

function revalidate(): void {
  revalidatePath("/ocia/calendar"); // the read path (enabled feeds) reflects changes
  revalidatePath("/ocia/calendar/sources"); // the management list itself
}

export async function createSourceAction(input: CalendarSourceInput): Promise<void> {
  const { parishId, userId } = await requireStaff("/ocia/calendar", "ocia");
  assertValid(input);
  await createSource(parishId, userId, input);
  revalidate();
}

export async function updateSourceAction(id: string, input: CalendarSourceInput): Promise<void> {
  const { parishId } = await requireStaff("/ocia/calendar", "ocia");
  assertValid(input);
  await updateSource(parishId, id, input);
  revalidate();
}

/** Toggle a feed on/off — the common admin action; no full-row round-trip. */
export async function setSourceEnabledAction(id: string, enabled: boolean): Promise<void> {
  const { parishId } = await requireStaff("/ocia/calendar", "ocia");
  await setSourceEnabled(parishId, id, enabled);
  revalidate();
}

export async function deleteSourceAction(id: string): Promise<void> {
  const { parishId } = await requireStaff("/ocia/calendar", "ocia");
  await deleteSource(parishId, id);
  revalidate();
}
