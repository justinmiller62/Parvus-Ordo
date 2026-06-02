# Gas City — Parva-Ordo development orchestration

This directory is the **version-controlled config** for the Gas City multi-agent workflow we use to
develop Parva-Ordo. The live city runs from `~/Desktop/parva-ordo-city` (outside the repo); its
**runtime** (the Dolt beads DB, worktrees, event logs, and the regenerable `.gc/system/` bundled packs)
is gitignored. Only the durable config lives here.

## What's tracked here
- `city.toml` / `pack.toml` — city + rig wiring (gastown pack imported at rig scope; `formula_v2`; the
  pilot guard patches; per-rig `formula_vars` = `pnpm install` / `typecheck` / `test`).
- `agents/<name>/` — the specialist roster (prompt templates + `agent.toml`): the four review-quorum
  agents (`security-auditor`, `architecture-reviewer`, `quality-linter`, `test-engineer`), the
  `platform-architect`, and the suspended implementers (`core-dev`, `web-dev`, `narthex-porter`).
- `gated-mayor.template.md` — the **review-gated mayor** prompt. NOT dropped under `agents/mayor/`
  because a city-scoped `mayor` collides with gastown's own mayor (hard duplicate). Apply it as a
  prompt_template **override** on gastown's mayor before unleashing autonomous dispatch.

## The workflow this encodes
Every code-change bead flows: **polecat implements (own worktree, runs typecheck+unit) → 4-reviewer
quorum (security / architecture / quality / test-engineer, the last actually runs the tests) → refinery
merges** only when all four approve. Tiered tests: unit+typecheck per bead; integration+e2e at the
branch before it reaches `development`.

## Bootstrap a fresh city from this config
```bash
brew install gastownhall/gascity/gascity            # + deps: bd/dolt, flock, tmux, jq, gh
gc init --provider claude ~/Desktop/parva-ordo-city # scaffolds runtime + materializes .gc/system packs
cp ops/gascity/city.toml ops/gascity/pack.toml ~/Desktop/parva-ordo-city/
cp -R ops/gascity/agents/* ~/Desktop/parva-ordo-city/agents/
cd ~/Desktop/parva-ordo-city
gc rig add <path-to-this-repo> --name parva-ordo --prefix po --adopt   # rig inherits the gastown crew
gc bd bootstrap && gc doctor                        # expect config-valid ✓
gc start                                            # launch the supervisor
```

## Hard-won setup notes (so the next person doesn't relearn them)
- **Crew only stamps onto rigs added *after* the rig-level import exists.** If `parva-ordo/gastown.polecat`
  won't resolve, re-add the rig with `--adopt` so it inherits `[defaults.rig.imports.gastown]`.
- **Don't double-import gastown** (city-level `[imports.gastown]` *and* a `pack=` reference) — it
  produces a duplicate `gastown.mayor` that hard-fails config validation.
- **Rig-scoped agents are patched by their rig-qualified name** (`parva-ordo/gastown.refinery`), not the
  bare name.
- **Verdict-recording must be shell-safe.** Agents' `gc bd update --append-notes` calls silently drop
  notes containing `??`, backticks, or quotes. Reviewers record verdicts as a **label**
  (`-l verdict-approve` / `-l verdict-reject`) + symbol-free note + `gc bd close` (see each reviewer
  prompt's "Recording your GATE verdict" section).
- **The gate is currently supervisor-enforced** (a human suspends the refinery and confirms approvals).
  TODO before unattended runs: make it **structural** — dependency-block the refinery merge bead on the
  four `verdict-approve` review beads so it cannot merge unreviewed.

## Scriptorium naming (Parvus Ordo ↔ gastown)
We talk in parish terms; `gc` commands use the gastown identifiers.
| Parvus Ordo | gastown id | Role |
| --- | --- | --- |
| Rector | mayor | coordinates the work |
| Scribe | gastown.polecat | writes the code (instances = scholar-saints, `scribe-namepool.txt`) |
| Censor | the 4 reviewers | examine the manuscript before merge |
| Sacristan | gastown.refinery | admits approved work into the codebase |
| Sentinel | gastown.witness | watches over the work |
| Deacon | gastown.deacon | patrols / upkeep |
| Sexton | the dog pool | menial chores |

Scribe instance names come from the pack's `namepool.txt`, which `gc` regenerates — so the saint names
take effect on a fresh city start (after a reboot), not mid-run. Re-apply with the `cp` in
`scribe-namepool.txt`.
