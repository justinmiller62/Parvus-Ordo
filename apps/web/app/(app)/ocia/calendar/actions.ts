"use server";

import { revalidatePath } from "next/cache";
import {
  type CalendarEventInput,
  createCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEvent,
} from "@parvaordo/core";
import { requireStaff } from "@/src/lib/require-role";

// Add / edit / delete a parish calendar event. canEdit on the calendar = catechist + admin
// (Narthex isTeacherOrAdmin), so all three gate on requireStaff. Title + date are required
// (the modal blocks submit without them; re-checked here as the server-side backstop).
// Core normalizes blanks, event_type, and the recurrence flag; RLS scopes the write.

function assertValid(input: CalendarEventInput): void {
  if (!input.title?.trim()) throw new Error("Event title is required");
  if (!input.eventDate) throw new Error("Event date is required");
}

export async function createEventAction(input: CalendarEventInput): Promise<void> {
  const { parishId, userId } = await requireStaff("/ocia/calendar", "ocia");
  assertValid(input);
  await createCalendarEvent(parishId, userId, input);
  revalidatePath("/ocia/calendar");
}

export async function updateEventAction(id: string, input: CalendarEventInput): Promise<void> {
  const { parishId } = await requireStaff("/ocia/calendar", "ocia");
  assertValid(input);
  await updateCalendarEvent(parishId, id, input);
  revalidatePath("/ocia/calendar");
}

export async function deleteEventAction(id: string): Promise<void> {
  const { parishId } = await requireStaff("/ocia/calendar", "ocia");
  await deleteCalendarEvent(parishId, id);
  revalidatePath("/ocia/calendar");
}
