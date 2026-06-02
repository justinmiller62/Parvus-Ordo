import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeDb,
  createCalendarEvent,
  createSource,
  deleteCalendarEvent,
  getCalendarEvent,
  listCalendarEvents,
  listAllSources,
  listEnabledSources,
  setSourceEnabled,
  updateCalendarEvent,
} from "@parvaordo/core";

const { Client } = pg;

// Seeded fixtures (infra/db/seed.mjs): HS + SM are both in diocese AJ; St. Peter is in
// diocese Erie. This lets us prove parish isolation, the diocese READ cascade (AJ rows
// reach HS+SM but not St. Peter), and global cascade — all on the real RLS database.
const AJ = "00000000-0000-0000-0000-000000000001";
const ERIE = "00000000-0000-0000-0000-000000000002";
const HS = "11111111-1111-1111-1111-111111111111"; // Holy Spirit (AJ)
const SM = "22222222-2222-2222-2222-222222222222"; // St. Monica (AJ)
const STP = "33333333-3333-3333-3333-333333333333"; // St. Peter (Erie)

const TAG = "INT-cal:";
const DATE = "2026-07-15";
const RANGE: [string, string] = ["2026-07-01", "2026-07-31"];

let owner: InstanceType<typeof Client>;
let userId: string;

// owner = the migration role; it OWNS the tables so it bypasses RLS and can seed rows at
// any scope (diocese/global) that the parish-scoped write policies forbid through getDb.
beforeAll(async () => {
  owner = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await owner.connect();
  const u = await owner.query<{ id: string }>(
    "INSERT INTO users (email, display_name) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id",
    ["cal-int-creator@example.com", TAG + "creator"],
  );
  userId = u.rows[0]!.id;
});

afterAll(async () => {
  await owner.query("DELETE FROM calendar_events WHERE title LIKE $1", [TAG + "%"]);
  await owner.query("DELETE FROM calendar_sources WHERE name LIKE $1", [TAG + "%"]);
  await owner.query("DELETE FROM users WHERE email = $1", ["cal-int-creator@example.com"]);
  await owner.end();
  await closeDb();
});

const titles = (events: { title: string }[]) => events.map((e) => e.title);

describe("calendar_events RLS — parish isolation + diocese/global cascade", () => {
  it("isolates a parish event to its own parish", async () => {
    const id = await createCalendarEvent(HS, userId, {
      title: TAG + "HS Feast",
      eventDate: DATE,
      eventType: "custom",
    });
    expect(id).toBeTruthy();

    expect(titles(await listCalendarEvents(HS, ...RANGE))).toContain(TAG + "HS Feast");
    expect(titles(await listCalendarEvents(SM, ...RANGE))).not.toContain(TAG + "HS Feast");
    expect(titles(await listCalendarEvents(STP, ...RANGE))).not.toContain(TAG + "HS Feast");

    // Cross-tenant single read is also blocked.
    expect(await getCalendarEvent(SM, id!)).toBeNull();
    expect(await getCalendarEvent(HS, id!)).not.toBeNull();
  });

  it("cascades a diocese event down to that diocese's parishes only", async () => {
    await owner.query(
      "INSERT INTO calendar_events (scope, diocese_id, title, event_date, event_type) VALUES ('diocese', $1, $2, $3::date, 'liturgical')",
      [AJ, TAG + "AJ Feast", DATE],
    );
    // Both AJ parishes inherit it…
    expect(titles(await listCalendarEvents(HS, ...RANGE))).toContain(TAG + "AJ Feast");
    expect(titles(await listCalendarEvents(SM, ...RANGE))).toContain(TAG + "AJ Feast");
    // …but an Erie parish does not (diocese is scoped, not all-diocese).
    expect(titles(await listCalendarEvents(STP, ...RANGE))).not.toContain(TAG + "AJ Feast");

    // And the reverse: an Erie diocese event is invisible to AJ parishes.
    await owner.query(
      "INSERT INTO calendar_events (scope, diocese_id, title, event_date, event_type) VALUES ('diocese', $1, $2, $3::date, 'liturgical')",
      [ERIE, TAG + "Erie Feast", DATE],
    );
    expect(titles(await listCalendarEvents(STP, ...RANGE))).toContain(TAG + "Erie Feast");
    expect(titles(await listCalendarEvents(HS, ...RANGE))).not.toContain(TAG + "Erie Feast");
  });

  it("cascades a global event to every parish", async () => {
    await owner.query(
      "INSERT INTO calendar_events (scope, title, event_date, event_type) VALUES ('global', $1, $2::date, 'obligation')",
      [TAG + "Global Holy Day", DATE],
    );
    for (const p of [HS, SM, STP]) {
      expect(titles(await listCalendarEvents(p, ...RANGE)), p).toContain(TAG + "Global Holy Day");
    }
  });

  it("blocks cross-tenant writes via RLS", async () => {
    const id = (await createCalendarEvent(HS, userId, {
      title: TAG + "HS Guarded",
      eventDate: DATE,
      eventType: "custom",
    }))!;

    // SM cannot update or delete HS's row — the UPDATE/DELETE USING clause filters it out.
    await updateCalendarEvent(SM, id, { title: TAG + "HACKED", eventDate: DATE, eventType: "custom" });
    await deleteCalendarEvent(SM, id);

    const stillThere = await getCalendarEvent(HS, id);
    expect(stillThere?.title).toBe(TAG + "HS Guarded");
  });
});

describe("calendar_sources RLS — enabled filter + isolation + cascade", () => {
  it("shows only enabled sources on the read path, all on the admin path", async () => {
    const enabled = await createSource(HS, userId, {
      name: TAG + "HS Feed",
      url: "https://calendar.google.com/hs.ics",
      enabled: true,
    });
    const disabled = await createSource(HS, userId, {
      name: TAG + "HS Hidden Feed",
      url: "https://calendar.google.com/hidden.ics",
      enabled: false,
    });
    expect(enabled && disabled).toBeTruthy();

    const enabledNames = (await listEnabledSources(HS)).map((s) => s.name);
    expect(enabledNames).toContain(TAG + "HS Feed");
    expect(enabledNames).not.toContain(TAG + "HS Hidden Feed");

    const allNames = (await listAllSources(HS)).map((s) => s.name);
    expect(allNames).toContain(TAG + "HS Feed");
    expect(allNames).toContain(TAG + "HS Hidden Feed");

    // Toggling the hidden feed on surfaces it on the read path.
    await setSourceEnabled(HS, disabled!, true);
    expect((await listEnabledSources(HS)).map((s) => s.name)).toContain(TAG + "HS Hidden Feed");
  });

  it("isolates sources to the owning parish", async () => {
    expect((await listAllSources(SM)).map((s) => s.name)).not.toContain(TAG + "HS Feed");
    expect((await listEnabledSources(STP)).map((s) => s.name)).not.toContain(TAG + "HS Feed");
  });

  it("cascades a diocese source to that diocese's parishes only", async () => {
    await owner.query(
      "INSERT INTO calendar_sources (scope, diocese_id, name, url, enabled) VALUES ('diocese', $1, $2, $3, true)",
      [AJ, TAG + "AJ Diocesan Feed", "https://calendar.google.com/aj.ics"],
    );
    expect((await listEnabledSources(HS)).map((s) => s.name)).toContain(TAG + "AJ Diocesan Feed");
    expect((await listEnabledSources(SM)).map((s) => s.name)).toContain(TAG + "AJ Diocesan Feed");
    expect((await listEnabledSources(STP)).map((s) => s.name)).not.toContain(TAG + "AJ Diocesan Feed");
  });
});
