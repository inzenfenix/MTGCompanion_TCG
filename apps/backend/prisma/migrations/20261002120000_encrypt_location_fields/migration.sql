-- ROADMAP.md O3: lastLat/lastLng become AES-256-GCM ciphertext (TEXT).
-- Existing plaintext coordinates are cast to text here; SQL can't encrypt
-- them (the key never reaches the database), so
-- src/scripts/encrypt-existing-fields.ts must run right after this migration —
-- docker-entrypoint.sh runs both, in that order, on container start.
ALTER TABLE "user_settings"
  ALTER COLUMN "lastLat" SET DATA TYPE TEXT USING "lastLat"::text,
  ALTER COLUMN "lastLng" SET DATA TYPE TEXT USING "lastLng"::text;
