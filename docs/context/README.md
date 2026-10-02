# OKF — apps's context/knowledge folder

OKF exists so any agent (or person) picking up work inside `apps/`
has the full picture of this subsystem without re-deriving it from scratch —
same motivation as `ROADMAP.md` at the repo root, just scoped to "MTG
Companion" (the commercial app) instead of the ML coursework.

**Start here, in this order:**

1. `apps/CLAUDE.md` — harness rules for working in this subtree.
2. This file, for the map below.
3. The specific subfolder for the piece you're touching.
4. The canonical source it links to, if you need ground truth rather than a
   summary (see freshness policy below).

## Map

| Folder | Covers |
|---|---|
| [`models/`](models/README.md) | The 4-stage ML pipeline as consumed here: which checkpoint each framework/stage actually uses, what's exported to ONNX and published in `apps/mobile/public/models/`, and the export gotchas that bit us. |
| [`tools/`](tools/README.md) | Dev tooling and conventions shared across `ml/` and `apps/`: venv-per-framework, the CLI/exit-code/`output/` contract, `HashingVectorizer`, shared OpenCV helpers, Optuna, desktop-runner as orchestrator. |
| [`apps/`](apps/README.md) | The three sub-apps that make up `apps/` — `apps/mobile`, `backend`, `desktop-runner` — how they fit together, plus one file per app with its internal architecture. |
| [`infra/`](infra/README.md) | AWS/Terraform deployment (`infra/terraform`), the desktop-runner "Deploy" tab, credential-handling policy. |
| [`environment/`](environment/README.md) | Dev-machine specifics that affect this subtree (ROCm/AMD GPU, tesseract, JDK/Android SDK for the APK build) — condensed from root `CLAUDE.md`, which stays canonical. |
| [`decisions/`](decisions/README.md) | The "why" behind non-obvious choices and hard-won bugs — read this before you re-derive (and possibly re-break) something already settled. |
| [`roadmap-snapshot.md`](roadmap-snapshot.md) | A dated, mechanically-generated status snapshot of `ROADMAP.md`'s workstreams. Not a substitute for `ROADMAP.md` — see its own header. |
| [`../MAPEO_CIA.md`](../security/MAPEO_CIA.md) | Actor/data/CIA-risk mapping exercise for the whole system (client, backend, desktop-runner, infra, third parties) — a security-course deliverable, built from this same context. |

## Freshness policy — read before trusting anything here

This project has already hit doc rot once: as of this folder's creation
(2026-09-11), both `apps/README.md` and root
`docs/architecture/PIPELINE_INTEGRATION.md` still describe a state ("no ONNX model trained
yet", "Stage 2/3 don't exist") that root `CLAUDE.md` and the actual code
contradict — all 4 stages are done, exported, and wired into the client.
Nobody had gone back to update those docs after the work landed.

To avoid OKF rotting the same way:

- **Prefer pointers over copies.** Where a canonical source already exists
  (root `CLAUDE.md`, `ROADMAP.md`, a per-folder `README.md`, the code
  itself), OKF files link to it instead of restating it at length. If a
  summary here and its source ever disagree, **the source wins** — that's a
  sign this file needs updating, not the other way around.
- **Anything synthesized here that has no other home is dated.** If you
  read a claim in `docs/context/` with no date and no link, and you're not sure it's
  still true, grep the actual code/config before relying on it.
- **`apps/README.md` and root `docs/architecture/PIPELINE_INTEGRATION.md` are
  known stale as of this writing** (see above) — this folder was added
  without rewriting them (out of scope for the task that created OKF).
  Don't propagate their claims about model/export status; trust
  `docs/context/models/README.md` (and, above that, the actual files in
  `apps/mobile/public/models/` and each framework's `models/`
  directory) instead.
- If you update something OKF describes, update the relevant OKF file in
  the same change — same convention as "always update ROADMAP.md" — and
  keep it short rather than letting it drift into unmaintained prose.
