import { expect, test } from "@playwright/test";

// The programmatic /api/v1 weekly export is bearer-authed (Parvus Studio iOS pattern).
// These pin the auth boundary without minting an app token; the authed staff/non-staff +
// happy-path coverage rides with the broader /api/v1 bearer-auth effort (po-78ur).
const COHORT = "0e2e0000-0000-0000-0000-0000000000e1"; // seeded e2e cohort

test("programmatic weekly export rejects an unauthenticated caller (401)", async ({ request }) => {
  const res = await request.get(`/api/v1/weekly-export?cohortId=${COHORT}&week=1`);
  expect(res.status()).toBe(401);
});

test("programmatic weekly export rejects an invalid bearer token (401)", async ({ request }) => {
  const res = await request.get(`/api/v1/weekly-export?cohortId=${COHORT}&week=1`, {
    headers: { authorization: "Bearer not-a-real-token" },
  });
  expect(res.status()).toBe(401);
});
