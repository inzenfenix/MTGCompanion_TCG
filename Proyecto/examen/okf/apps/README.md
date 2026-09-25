# Apps — how the three pieces of `examen/` fit together

```
┌─────────────────────── trading-app-ionic (Ionic React + Capacitor) ───────────────────────┐
│                                                                                             │
│  Camera (getUserMedia/Capacitor Camera)                                                    │
│    → OpenCV.js: cardLocalizer.ts (crop/perspective/CLAHE)                                  │
│    → onnxruntime-web: Stage 1 detector → Stage 2 text validator → Stage 3 price            │
│      estimator (PyTorch-only, see okf/models) → Stage 4 condition grader                   │
│    → tesseract.js (in-browser OCR) + GET /catalog/search[-by-text] → identifyCard.ts       │
│      resolves *which* catalog card this is                                                 │
│                                                                                             │
│  All of the above is 100% client-side inference — the backend never sees a photo           │
│  or runs a model.                                                                          │
└──────────────────────────────────────┬──────────────────────────────────────────────────┘
                                        │ account / cards+photos / transactions / offers / decks
                                        ▼
                    ┌───────────────────────────────────────────┐
                    │  backend (NestJS + Prisma + PostgreSQL)     │
                    │  domain/application/infrastructure/         │
                    │  presentation per module — see apps/backend │
                    │  S3-compatible object storage (photos)      │
                    └───────────────────────────────────────────┘

┌──────────────────────── desktop-runner (Electron + NestJS + React) ───────────────────────┐
│  Not part of the runtime app above — this is the dev-side GUI that produces the ONNX       │
│  models trading-app-ionic consumes (wraps certamen_1/certamen_2's Python pipeline) and,     │
│  separately, drives AWS/Terraform deploys for backend infra (see okf/infra).                │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

## Per-app detail

- [`trading-app-ionic.md`](trading-app-ionic.md) — client ML wiring, pages,
  what's actually connected vs. still mock.
- [`backend.md`](backend.md) — NestJS modules, DDD layering, Prisma schema,
  what's stubbed.
- [`desktop-runner.md`](desktop-runner.md) — pipeline orchestration UI,
  process/log streaming, Deploy tab.

## The one invariant that matters most

**Inference never moves to the backend.** Every design decision in this
project (ONNX over a server-side Python inference API, `onnxruntime-web`,
client-side OpenCV.js/tesseract.js) exists to keep Stage 1–4 running
entirely on-device. The backend's job is strictly persistence (accounts,
cards+photos, transactions, offers, decks, coupons) — if a change proposes
sending a photo or a model output to the backend for inference, that's an
architecture change, not a bug fix, and should be flagged as such rather
than done quietly.
