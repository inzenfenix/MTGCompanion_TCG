# `backend/` — NestJS + Prisma + PostgreSQL

Persistence only — accounts, cards+photos, transactions, offers, decks,
coupons. Never runs ML inference (see `okf/apps/README.md`'s invariant).
Docker (`backend/docker/`) is dev-only (Postgres + MinIO + MailHog) — the
backend itself doesn't run in Docker. Full up-to-date status lives in
`backend/README.md`'s own "Estado actual" section — treat that section as
canonical over this summary; this file is the structural map.

## Module layout — DDD per module

Every business module (`users`, `auth`, `cards`, `catalog`, `transactions`,
`offers`, `decks`, `coupons`) follows the same 4-layer split:

```
<module>/
  domain/           entities, repository interfaces
  application/       use-case services
  infrastructure/     Prisma-backed repository implementations
  presentation/        controllers, DTOs, guards
```

`payments` and `notifications` are cross-cutting (used by `transactions`)
and follow a provider-interface pattern instead: `payments/` has
`payment-provider.interface.ts` + `providers/{noop,cash,mercadopago}-payment.provider.ts`,
selected per-transaction (`Transaction.paymentMethod`) via
`PAYMENT_PROVIDERS` (`payments.module.ts`); `notifications/` mirrors this
with `email-provider.interface.ts` + `providers/{smtp,ses}-email.provider.ts`
plus event `listeners/` (`user-created`, `transaction-paid`) and
`templates/`. **New modules should follow the DDD 4-layer pattern above,
not invent a new shape** — same spirit as root `CLAUDE.md`'s conventions for
the Python side.

## Prisma models (`prisma/schema.prisma`)

`User`, `UserSettings`, `RefreshToken`, `Card`, `Deck`, `Offer`,
`CardPhoto`, `CatalogCard`, `Transaction`, `Coupon`.

## What's real vs. stubbed (as of this writing — check `backend/README.md` for current state)

- **Real**: JWT login + refresh-token rotation (`POST /auth/login`,
  `/auth/refresh` — opaque 512-bit refresh token, SHA-256-hashed at rest,
  single-use), TOTP 2FA (`otplib`) end-to-end on the backend, ownership
  checks (editing/deleting another user's card 404s, not 403 — doesn't
  confirm the id exists to a non-owner), card CRUD + presigned-URL photo
  upload to S3-compatible storage, MercadoPago Checkout Pro (official SDK,
  webhook signature verification, `Payment.get()` re-queried rather than
  trusting the webhook body) alongside a `CashPaymentProvider` fast path,
  a `NoopPaymentProvider` fallback when `MERCADOPAGO_ACCESS_TOKEN` isn't
  set (today's default — zero behavior change without real credentials).
- **Not yet consumed by the client**: `POST /auth/refresh` (`AuthContext.tsx`
  just logs out on 401), the 2FA challenge response
  (`SecuritySettings.tsx` is still a static mock — see
  `apps/trading-app-ionic.md`).
- **Not tested live**: a full MercadoPago sandbox round-trip — no sandbox
  `MERCADOPAGO_ACCESS_TOKEN`/`MERCADOPAGO_WEBHOOK_SECRET` in this repo, and
  MercadoPago can't call back a `localhost` `notification_url` without a
  public tunnel.
- **Not modeled at all**: a user balance/wallet field — Tab 1's treasury
  balance in the client is still a fixed mock; could now be derived from
  `PAID` transactions but isn't wired.
- **No logout/revoke-all endpoint** — `RefreshToken` already has the
  `userId` index a bulk-revoke would need, but the repository method isn't
  written (no real caller yet, so no speculative code was added).

## Price estimation has no backend endpoint — by design, not a gap

There is (deliberately) no server-side price-estimation route: Stage 3 runs
client-side (`stage1Detector`-pattern ONNX inference, `stage3PriceEstimator.ts`),
called live from the scan flow (`ListCard.tsx`, `Tab2.tsx`) to produce
`guessedPrice`, which is then just a normal field the backend persists on
`Card`/`Transaction` — the backend never computes or re-derives it. If a
future change wants server-verified pricing (e.g. to stop a client from
submitting an arbitrary price), that's a real architecture decision to flag,
not an obvious bug fix — see `okf/apps/README.md`'s invariant.
