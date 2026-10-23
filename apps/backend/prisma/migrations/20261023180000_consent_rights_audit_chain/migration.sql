-- ROADMAP.md O15 (Actividad N°5): consent per purpose, data-subject rights
-- requests, hash-chained audit log with retention, security alerts, account
-- containment state. See docs/security/ACTIVIDAD_5.md.

-- -- Account state --
ALTER TABLE "users"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "disabledAt" TIMESTAMP(3),
  ADD COLUMN "sessionsRevokedAt" TIMESTAMP(3),
  ADD COLUMN "lockedUntil" TIMESTAMP(3);

-- -- Consent --
CREATE TYPE "consent_status" AS ENUM ('GRANTED', 'REVOKED');

CREATE TABLE "consents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "consent_status" NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "consents_userId_purpose_key" ON "consents"("userId", "purpose");

ALTER TABLE "consents" ADD CONSTRAINT "consents_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "consent_events" (
    "id" TEXT NOT NULL,
    "consentId" TEXT NOT NULL,
    "action" "consent_status" NOT NULL,
    "version" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "consent_events_consentId_createdAt_idx" ON "consent_events"("consentId", "createdAt");

ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_consentId_fkey"
  FOREIGN KEY ("consentId") REFERENCES "consents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Consent history can't be rewritten: UPDATE is rejected for every
-- connection. DELETE stays possible (the ON DELETE CASCADE from consents <-
-- users), because erasing an account must erase its consent history too.
CREATE FUNCTION "consent_events_no_update"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'consent_events history cannot be modified (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "consent_events_no_update"
  BEFORE UPDATE ON "consent_events"
  FOR EACH ROW EXECUTE FUNCTION "consent_events_no_update"();

-- Backfill: before O15, location and email preferences lived only as flags
-- in user_settings. Carry the ones that were on over as consent version
-- "0" (the pre-O15 wording) — ConsentService treats a version older than
-- the current one as needing re-consent, so these users are asked again
-- with the new text instead of being silently assumed to have accepted it.
-- notifyByEmail defaulted to true without anyone ticking anything, so it
-- is NOT carried over: a default is not an affirmative act (art. 12).
INSERT INTO "consents" ("id", "userId", "purpose", "version", "status", "grantedAt", "updatedAt")
SELECT gen_random_uuid()::text, s."userId", 'LOCATION_DISTANCE', '0', 'GRANTED',
       COALESCE(s."locationUpdatedAt", CURRENT_TIMESTAMP), CURRENT_TIMESTAMP
FROM "user_settings" s
WHERE s."shareLocation" = true;

INSERT INTO "consents" ("id", "userId", "purpose", "version", "status", "grantedAt", "updatedAt")
SELECT gen_random_uuid()::text, s."userId", 'TWO_FACTOR', '0', 'GRANTED',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "user_settings" s
WHERE s."twoFactorEnabled" = true;

INSERT INTO "consent_events" ("id", "consentId", "action", "version", "textHash", "source")
SELECT gen_random_uuid()::text, c."id", 'GRANTED', '0', 'pre-o15', 'migration'
FROM "consents" c;

-- From now on notifyByEmail is derived from the EMAIL_NOTIFICATIONS consent.
ALTER TABLE "user_settings" ALTER COLUMN "notifyByEmail" SET DEFAULT false;
UPDATE "user_settings" SET "notifyByEmail" = false;

-- -- Data-subject rights requests --
CREATE TYPE "data_rights_type" AS ENUM ('ACCESS', 'RECTIFICATION', 'ERASURE');
CREATE TYPE "data_rights_status" AS ENUM ('RECEIVED', 'VERIFIED', 'IN_EVALUATION', 'CLOSED');
CREATE TYPE "data_rights_outcome" AS ENUM ('FULFILLED', 'DENIED');

CREATE TABLE "data_rights_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "data_rights_type" NOT NULL,
    "status" "data_rights_status" NOT NULL DEFAULT 'RECEIVED',
    "outcome" "data_rights_outcome",
    "verificationMethod" TEXT,
    "stepUpJti" TEXT,
    "details" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "evaluatedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_rights_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "data_rights_requests_stepUpJti_key" ON "data_rights_requests"("stepUpJti");
CREATE INDEX "data_rights_requests_userId_idx" ON "data_rights_requests"("userId");
CREATE INDEX "data_rights_requests_status_dueAt_idx" ON "data_rights_requests"("status", "dueAt");

-- -- Security alerts --
CREATE TYPE "alert_severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "alert_status" AS ENUM ('OPEN', 'INVESTIGATING', 'CONFIRMED', 'DISMISSED', 'CLOSED');

CREATE TABLE "security_alerts" (
    "id" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "severity" "alert_severity" NOT NULL,
    "status" "alert_status" NOT NULL DEFAULT 'OPEN',
    "subjectPseudonym" TEXT,
    "details" JSONB,
    "resolutionNote" TEXT,
    "handledBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "security_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "security_alerts_status_createdAt_idx" ON "security_alerts"("status", "createdAt");
CREATE INDEX "security_alerts_rule_subjectPseudonym_createdAt_idx" ON "security_alerts"("rule", "subjectPseudonym", "createdAt");

-- -- Audit log: hash chain, resource columns, retention --
-- ADD COLUMN with a sequence default fills existing rows, which fires no
-- row trigger (it's a table rewrite, not an UPDATE), so the append-only
-- trigger doesn't need lifting. Existing rows get seq in insertion order.
ALTER TABLE "audit_logs"
  ADD COLUMN "seq" BIGSERIAL NOT NULL,
  ADD COLUMN "resourceType" TEXT,
  ADD COLUMN "resourceRef" TEXT,
  ADD COLUMN "prevHash" TEXT,
  ADD COLUMN "hash" TEXT,
  ALTER COLUMN "actorRole" DROP NOT NULL;

CREATE UNIQUE INDEX "audit_logs_seq_key" ON "audit_logs"("seq");
CREATE INDEX "audit_logs_actorPseudonym_action_createdAt_idx" ON "audit_logs"("actorPseudonym", "action", "createdAt");

-- Retention (ACTIVIDAD_5.md §3.5): UPDATE and TRUNCATE stay forbidden for
-- everyone. DELETE is allowed only when BOTH hold:
--   1. the session opted in with SET LOCAL app.audit_retention_purge = 'on'
--      (only src/scripts/purge-expired-data.ts does), and
--   2. the row is older than app.audit_retention_days (default 730), with a
--      hard floor of 365 days no session setting can go below.
-- So a bug or a stolen app credential still can't erase recent evidence.
CREATE OR REPLACE FUNCTION "audit_logs_append_only"() RETURNS trigger AS $$
DECLARE
  retention_days integer := GREATEST(
    COALESCE(NULLIF(current_setting('app.audit_retention_days', true), '')::integer, 730),
    365);
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.audit_retention_purge', true) = 'on'
     AND OLD."createdAt" < (CURRENT_TIMESTAMP - make_interval(days => retention_days)) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
