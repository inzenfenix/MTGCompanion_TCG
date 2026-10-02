# ROADMAP snapshot — 2026-09-11

**This is a dated, mechanically-generated status count, not a substitute
for [`ROADMAP.md`](../../../ROADMAP.md).** It was produced by counting rows
marked ✅/🚧 per workstream heading at the time this file was written — it
will be wrong the moment `ROADMAP.md` changes again, which happens often.
Open `ROADMAP.md` itself for ground truth; use this only to orient which
workstreams are essentially finished vs. still open before diving in.

| Workstream | Rows | Marked ✅ | Marked 🚧 |
|---|---:|---:|---:|
| A. Stage 2 — Text validator | 5 | 5 | 0 |
| B. Stage 3 — Price estimator | 6 | 6 | 0 |
| C. Desktop-runner integration (Stage 2+3) | 11 | 11 | 0 |
| D. AMD/ROCm Docker image for TF GPU | 7 | 7 | 0 |
| E. Ionic integration | 6 | 9* | 0 |
| F. Backend | 5 | 5 | 0 |
| G. Testing | 4 | 8* | 0 |
| H. Statistics & reporting | 6 | 6 | 0 |
| I. AWS infrastructure via Terraform | 40 | 34 | 1 |
| J. QR-based buyer/seller trading flow | 15 | 18* | 0 |
| K. Vault decks/folders | 7 | 6 | 0 |
| L. Spin-the-wheel coupon system | 6 | 6 | 0 |
| M. CI/CD: build APK from shared model store | 3 | 3 | 0 |
| N. Charts tab in desktop-runner | 1 | 1 | 0 |

\* "Marked ✅" can exceed "Rows" where a top-level row's own text contains
a nested `✅` (e.g. a sub-point called out inline) — the count is a rough
signal, not an exact row tally.

## Reading this

By this count, workstreams A–H, K, L, M, N read as essentially closed out;
**I (AWS infra)** has the one row still showing 🚧 as of this writing and is
by far the largest workstream (40 rows) — see `okf/infra/README.md` and
`infra/PLAN.md`. **J (trading flow)** is large and under active development
per recent commit history (e.g. "J15 identify/sell flow"). If you're
choosing a workstream to pick up, `ROADMAP.md` itself — not this file — has
the per-row priority (P0/P1/P2) and complexity (S/M/L/XL) needed to actually
choose, plus the row-level 🚧 in-progress claim markers other sessions may
have set (root `CLAUDE.md` rule 3) since this snapshot was taken.
