# CLAUDE.md — `apps/`

This file is scoped to `apps/` — "MTG Companion", the commercial
app built on top of the ML pipeline trained in `ml/` — plus `infra/` and
`docs/context/`, which serve these apps (this subtree used to be
`Proyecto/examen/` before ROADMAP.md workstream P's reorg).
**It supplements the root `CLAUDE.md`, it does not replace it** — every rule
there (workflow expectations, hard rules, environment notes) applies here
too. Claude Code loads both automatically when working inside this
directory; read the root one if you haven't, especially its "Hard rules
established this project" section before touching training scripts.

## Read this first

1. **[`docs/context/README.md`](../docs/context/README.md)** — the context/knowledge folder for
   this subtree. It's categorized (models, tools, apps, infra, environment,
   decisions, roadmap snapshot) specifically so an agent picking up work
   here doesn't have to re-derive architecture, gotchas, or current state
   from scratch. Read the folder matching what you're about to touch before
   changing it.
2. Root `CLAUDE.md` and `ROADMAP.md` (repo root) — canonical project memory
   and backlog, shared across `ml/` and `apps/`.

`docs/context/` links out to canonical sources rather than duplicating them — if
something there conflicts with the actual code or with `ROADMAP.md`, the
code/`ROADMAP.md` wins and `docs/context/` needs updating, not the other way around.
Two docs already known stale as of this writing: `apps/README.md`
and root `docs/architecture/PIPELINE_INTEGRATION.md` (see `docs/context/README.md`'s freshness policy
for specifics) — don't trust their description of model/export status.

## What lives here

```
apps/
  mobile/          Ionic React + Capacitor client — 100% on-device ML inference (ONNX + onnxruntime-web, OpenCV.js, tesseract.js)
  backend/         NestJS + Prisma + PostgreSQL — accounts/cards/transactions/offers/decks/coupons persistence, never runs a model
  desktop-runner/  Electron + NestJS + React — GUI that orchestrates the ml/ training/export pipeline, plus AWS/Terraform Deploy tab
infra/terraform/   Terraform (AWS Academy Learner Lab) — one EC2 instance per service, SG-to-SG least privilege
docs/context/      context/knowledge folder for this subtree — read first, see above
```

## The one invariant to protect

**Inference stays client-side.** Every stage (1–4) runs in the browser/app
via `onnxruntime-web`; the backend only persists what the user already
decided to save. Don't route a photo or a model call through the backend as
a "quick fix" — that's an architecture change (see `docs/context/apps/README.md`),
flag it rather than doing it quietly.

## Workflow rules that apply with extra weight in this subtree

Everything in root `CLAUDE.md`'s "Workflow expectations" section applies —
these are the ones most likely to bite specifically inside `apps/`:

- **Plan first for anything touching more than one of the three sub-apps**,
  or any `docs/context/`/infra change of real size — same bar as root `CLAUDE.md`
  rule 1.
- **Claim + push + fetch cadence (root rule 3/4) matters more here**, not
  less — `apps/` is where most active parallel work happens
  (`ROADMAP.md` workstreams E, I, J, K, L are all here), so a stale local
  view collides faster than in the ML coursework side.
- **New backend modules follow the existing DDD 4-layer shape**
  (`domain/application/infrastructure/presentation`) — see
  `docs/context/apps/backend.md`. Don't invent a new module shape.
- **`RUN_ALL_*` sequences in `apps/desktop-runner/apps/server/src/scripts/scripts.config.ts`
  are the only place pipeline steps get registered** (root rule 7) — a new
  script needs an entry there, not a parallel runner.
- **ONNX export → Ionic publish convention** (root rule 3): every
  `*_export_onnx*.py` script publishes via `publicar_en_ionic()` into
  `apps/mobile/public/models/` under a fixed `stage{N}-{name}.onnx`
  name. Follow it exactly for any new export script.
- **AWS/deploy credentials never get written to a file in this repo** — see
  `docs/context/infra/README.md`. They go through `desktop-runner`'s Deploy tab
  (`~/.mtg-desktop-runner/settings.json`, outside the git tree) or as
  live env vars to a Bash-invoked command, never committed, never echoed
  into a file this session writes.

## Environment specifics unique to this subtree

Full detail in `docs/context/environment/README.md`; the two that most often matter
specifically for `apps/` work (as opposed to `ml/` training):
building the Android APK needs a system JDK 17–21 + Android SDK
(`apps/mobile/`, see root `README.md`), and the client's in-browser
OCR (`tesseract.js`) is a completely separate dependency from the system
`tesseract` binary the Python pipeline needs — don't conflate the two when
debugging an OCR issue.
