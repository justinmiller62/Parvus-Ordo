# Testing

Three layers (Architecture §14). The full list of cases lives in
[TEST-CATALOG.md](./TEST-CATALOG.md), generated from the specs.

| Layer | What | Command |
| --- | --- | --- |
| Unit | Pure logic, no DB (Vitest) | `pnpm test` |
| Integration | Real Postgres + RLS (Vitest) | `pnpm test:int` |
| End-to-end | Playwright, desktop + Pixel 5 | `pnpm test:e2e` |

## The test catalog (auto-generated)

```
pnpm test:catalog          # regenerate docs/TEST-CATALOG.md
pnpm test:catalog --check  # CI: fail if stale
```

The catalog is built straight from the `describe` / `it` / `test` **titles** — so
the titles are the spec. Write them as plain-English acceptance statements
("learner can't skip ahead past the first incomplete item") and the documentation
maintains itself. A file's leading comment becomes that file's intro line.

## Recording your own E2E tests (Playwright codegen)

You can record click-throughs into a ready-to-paste test:

1. Start the app: `pnpm dev` (must be running on :3000).
2. In another terminal: `pnpm test:e2e:record`
   - Opens a browser + the Playwright Inspector. Click through the app; it writes
     the matching `@playwright/test` code live.
   - To start already signed in, drive the dev bypass first: in the recorder's
     address bar go to `http://localhost:3000/dev/login?email=admin@parvaordo.test`
     (or `teacher@`/`student@parvaordo.test`).
3. Copy the generated code into a new `apps/web/e2e/<name>.spec.ts`.
4. **Make it self-cleaning** (house rule): anything the test creates it must delete
   through the UI, and per-user state is reset via `/dev/reset?email=…`. We do **not**
   reseed between runs (that would wipe real data like uploaded media). Prefer
   `getByRole`/`getByTestId` over brittle CSS selectors — add a `data-testid` if needed.
5. Run it: `pnpm test:e2e` (or `pnpm test:e2e:ui` for the interactive runner,
   `pnpm test:e2e:headed` to watch it).

## Conventions

- Specs are serialized (`workers: 1`) and run on **both** desktop and a phone
  viewport — mobile-friendliness is a hard requirement.
- Seeded rows (`docs`/lessons/the seeded video) are **read-only fixtures**.
- A fresh database is initialised once, explicitly: `pnpm db:reset`.
