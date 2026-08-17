-- ROADMAP.md I19/I21 — real on-device testing (adb logcat + screenshots on
-- a physical phone) proved `GET /catalog/search`'s plain `contains` search
-- (prisma-catalog.repository.ts) has no tolerance for an OCR-misread name
-- ("Moonstone Fuloyist" for the real "Moonstone Eulogist"): a `contains`
-- lookup for that string can never match anything, even though the real
-- card is one character-swap away. pg_trgm's similarity() gives the
-- repository a real fuzzy fallback for exactly that case.
--
-- The plain-`contains` comment this migration is fixing dates back to F6:
-- "a pg_trgm GIN index would be the real fix if this ever needs to scale,
-- not attempted here" — turned out to be needed for correctness (typo
-- tolerance), not just scale, so building the index at the same time.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "catalog_cards_name_trgm_idx" ON "catalog_cards" USING GIN ("name" gin_trgm_ops);
