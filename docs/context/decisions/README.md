# Decisions & gotchas — the "why", not just the "what"

Settled reasoning that's easy to accidentally re-litigate or re-break
because the "why" isn't visible from the code alone. If you're about to
change something that touches one of these, read the entry first.

## ONNX export: `external_data=False` is load-bearing

`torch.onnx.export()`'s dynamo-based exporter defaults to splitting weights
into a separate `.onnx.data` sidecar file — `publicar_en_ionic()` never
copied that sidecar, so every PyTorch-sourced ONNX file published to Ionic
was silently unloadable by `onnxruntime` until this was found (root
`CLAUDE.md`, ROADMAP.md workstream C). All 4 PyTorch export scripts now
pass `external_data=False`. TensorFlow's `tf2onnx.convert.from_keras()` was
never affected (single file by default) — don't add this flag there, it
doesn't apply.

## Stage 4: combined checkpoint, not the plain one — on both frameworks

The plain `condition_grader.{pth,keras}` scores *higher* on its own
held-out split (95.25%) but collapses to 38.7% real-photo accuracy — it
overfit to whatever made the curated dataset easy. The combined
(real+synthetic) checkpoint generalizes to real photos (72.2%) despite the
lower own-split number. If you're tuning Stage 4 and see the plain
checkpoint's metrics look better, that's the trap, not a signal to switch —
`predict_condition.py` documents the same reasoning.

## Stage 3: PyTorch-only client-side, by construction

PyTorch's Stage 3 export needs a 1330-dim input (50 tabular + 1280 visual
from `stage1-embedder.onnx`, PyTorch-only); TensorFlow's needs 626 (50 +
576) and has no embedding-export equivalent. `stage3PriceEstimator.ts` only
builds the 1280-dim path. This is a real architectural asymmetry between
the two frameworks for this one stage, not a bug — see
`docs/context/models/README.md` for the export-ordering trick that keeps
`stage3-price-estimator.onnx` always PyTorch's regardless of which
framework's other stages "win."

## `identifyCard.ts`: OCR + catalog search, not a visual-embedding index

Rejected a full nearest-neighbor visual-embedding index over the ~58,679-card
catalog (would need a separate server-side pipeline to embed and serve
every catalog card's image) once real measurement showed Stage 1's backbone
alone gets only ~18–25% real-photo Top-1 accuracy — not worth building
server infra for that ceiling. The chosen path (OCR name → catalog search →
OCR rules text → second catalog search → merge+rerank with Stage 2) reuses
already-built pieces and runs client-side, no new backend surface. Revisit
only if a materially better visual backbone changes that ceiling number.

## `HashingVectorizer`, not a fitted/persisted vectorizer

Deterministic (murmurhash3, fixed seed, no `.fit()`) so PyTorch and
TensorFlow can each build the exact same input features independently,
without shipping/syncing a vectorizer artifact between frameworks — required
for the cross-framework comparison in `ml/data-prep` to be fair, and it's why
the client can reimplement it in TypeScript (`hashingVectorizer.ts`) instead
of needing to load a Python-trained artifact at inference time. Any new
text-feature stage should follow this same pattern (root `CLAUDE.md` rule
4), not introduce a persisted vectorizer.

## ONNX + `onnxruntime-web`, not TensorFlow.js

The professor suggested TensorFlow.js; the team chose ONNX instead because
`ml/data-prep` trains every stage in *both* frameworks and picks the winner
per stage independently — committing to TensorFlow.js would have forced
discarding a PyTorch win. ONNX covers whichever framework actually won each
stage, without knowing in advance which one that'll be.

## `shared-scraper` is destructive; `shared-downloader`/`shared-real-photos` aren't

`01_scraper.py` unconditionally overwrites `data/cards.json`, truncated to
`--max-cards` (UI default 5,000) — this is why it's excluded from every
"run all" sequence (`docs/context/tools/README.md`). Don't add it to an automatic
sequence to "make setup easier" — that's the exact failure mode it's
excluded to prevent (silently shrinking the real 58k+ card dataset down to
5,000).

## Split by `card_id`, never by row

Stage 2 produces 2 rows/card, Stage 4 produces 5 rows/card — splitting a
train/val set by row leaks the same card's other rows across the split.
`split_por_carta()` in `10_condition_grader.py`/`14_text_validator.py` is
the reference implementation; any new per-card multi-row dataset should
reuse this pattern, not `sklearn.train_test_split` directly on rows.

## Privacy & access control (ROADMAP.md O14, 23 oct) — `docs/security/ACTIVIDAD_4.md`

- **Role is read from the DB on every request, not a JWT claim.** Demoting
  someone or deleting their account must take effect on the next request,
  not when the 15-min access token expires. Costs one user lookup per
  authenticated request — accepted. Don't "optimize" it into a token claim.
- **Pseudonyms are keyed HMAC, not a plain hash.** User ids (UUIDs) already
  circulate in listings/transactions, so `SHA-256(id)` could be reversed by
  hashing known ids. Scoped too: `audit` (stable, follow one actor) vs.
  `bid:<cardId>` (unlinkable across auctions). `PSEUDONYM_KEY` is separate
  from `FIELD_ENCRYPTION_KEY` on purpose.
- **`audit_logs` has no FK to `users` and is append-only by DB trigger**
  (UPDATE/DELETE/TRUNCATE raise). Tests and cleanup can't delete audit rows —
  that's intended, not a bug to work around (only `anonymize-db.ts`, as table
  owner on a dev copy, disables the trigger for one TRUNCATE).
- **Transactions: 403 for non-parties** (same as `confirm-cash-received`),
  unlike cards/decks which 404 to a non-owner. Staff access goes only
  through `GET /admin/users/:id/transactions?reason=…` (audited).
- **18+ declaration (`adultConfirmedAt`) instead of a birth date** — the
  marketplace is adults-only, so the age itself isn't needed (minimization).
  Self-declared, not verified; verifying would mean collecting more data.
- **Location: 2 decimals (~1 km) before encryption + 30-day TTL + revocable.**
  The app only shows km; exact GPS was disproportionate.
- **k = 5 suppression and no grand total** in the anonymized sales report —
  a grand total would let a suppressed cell be recovered by subtraction.

## Consent, rights, audit integrity (ROADMAP.md O15, 23 oct) — `docs/security/ACTIVIDAD_5.md`

- **Consent only for the optional purposes** (`LOCATION_DISTANCE`,
  `EMAIL_NOTIFICATIONS`, `TWO_FACTOR`); everything the service needs stays on
  the contract basis. Purposes + exact text + version live in code
  (`consent/domain/consent-purposes.ts`), bump `version` on any material text
  change — older consents then stop counting (`requiresReconsent`).
- **Processes ask `ConsentService.hasConsent(user, purpose)` at use time**;
  revocation's data effect (location erased, `notifyByEmail` mirror) runs in
  the same DB transaction as the revocation. `TWO_FACTOR` is only changed by
  the 2FA flow (needs a TOTP code), never by `/consents/me/:purpose` (409).
- **Rights requests are recorded rows** (`data_rights_requests`, no FK so they
  survive erasure) walking RECEIVED→VERIFIED→IN_EVALUATION→CLOSED, due in 30
  days. Export/erasure/email change need `POST /auth/step-up` (5-min,
  single-use via `stepUpJti @unique`); name/language need only the session.
- **Erasure deletes the user row when there are no transactions, otherwise
  tombstones it** (transactions are kept 6 years for tax law and have a
  non-cascading FK). Blocked while a transaction is PENDING, an auction is
  live, or the account has a staff role.
- **`audit_logs` is hash-chained (HMAC, key = HKDF(PSEUDONYM_KEY))**, appended
  under `pg_advisory_xact_lock`; use `AuditService.record` or `appendChained`
  — a raw `prisma.auditLog.create` row has `hash = null` and sits outside the
  chain. The trigger allows DELETE only from `purge-expired-data` (session
  flag) and only past `AUDIT_RETENTION_DAYS` (floor 365).
- **Detection runs on the audit stream** (`AUDIT_RECORDED_EVENT`, awaited):
  rules in `security/domain/detection-rules.ts`; auto-containment is only
  reversible (15-min lock, revoke sessions). `users.sessionsRevokedAt` kills
  access tokens issued before it (compared with `iat` in whole seconds).
- **No IPs stored** anywhere by design — distributed attacks are only visible
  by volume; rate limiting belongs at the network layer (not built).
