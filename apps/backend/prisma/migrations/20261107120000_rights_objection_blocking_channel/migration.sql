-- ROADMAP.md O16 / docs/security/ACTIVIDAD_6.md — request channel + public
-- contact form, objection (Ley 19.628 texto Ley 21.719, art. 8) and temporary
-- blocking (arts. 8 ter y 11).

-- -- Request types and states --
ALTER TYPE "data_rights_type" ADD VALUE 'OBJECTION';
ALTER TYPE "data_rights_type" ADD VALUE 'BLOCKING';
ALTER TYPE "data_rights_status" ADD VALUE 'AWAITING_CONFIRMATION' BEFORE 'RECEIVED';
ALTER TYPE "data_rights_status" ADD VALUE 'PENDING_STEP_UP' BEFORE 'RECEIVED';

CREATE TYPE "data_rights_channel" AS ENUM ('APP', 'EMAIL_FORM');

ALTER TABLE "data_rights_requests"
  ALTER COLUMN "userId" DROP NOT NULL,
  ADD COLUMN "channel" "data_rights_channel" NOT NULL DEFAULT 'APP',
  ADD COLUMN "scope" TEXT,
  ADD COLUMN "statement" VARCHAR(500),
  ADD COLUMN "relatedRequestId" TEXT,
  ADD COLUMN "requestBlocking" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "contactPseudonym" TEXT,
  ADD COLUMN "confirmTokenHash" TEXT,
  ADD COLUMN "expiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "data_rights_requests_confirmTokenHash_key" ON "data_rights_requests"("confirmTokenHash");
CREATE INDEX "data_rights_requests_contactPseudonym_receivedAt_idx" ON "data_rights_requests"("contactPseudonym", "receivedAt");

-- -- Processing controls (upheld objections, granted blockings) --
CREATE TYPE "processing_control_kind" AS ENUM ('OBJECTION', 'BLOCKING');
CREATE TYPE "processing_control_status" AS ENUM ('ACTIVE', 'LIFTED');

CREATE TABLE "processing_controls" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "processing_control_kind" NOT NULL,
    "scope" TEXT NOT NULL,
    "basis" TEXT,
    "status" "processing_control_status" NOT NULL DEFAULT 'ACTIVE',
    "requestId" TEXT NOT NULL,
    "relatedRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liftedAt" TIMESTAMP(3),
    "liftReason" TEXT,

    CONSTRAINT "processing_controls_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "processing_controls_userId_status_idx" ON "processing_controls"("userId", "status");
CREATE INDEX "processing_controls_relatedRequestId_idx" ON "processing_controls"("relatedRequestId");

ALTER TABLE "processing_controls" ADD CONSTRAINT "processing_controls_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one ACTIVE control per (user, kind, scope): two concurrent
-- objection requests can't both create one — the second fails here, at the
-- database, not just in code. Lifted rows don't count, so history is kept.
CREATE UNIQUE INDEX "processing_controls_one_active"
  ON "processing_controls"("userId", "kind", "scope")
  WHERE "status" = 'ACTIVE';

-- A lifted control stays lifted: re-opening one would rewrite history.
-- (A new objection/blocking creates a new row.)
CREATE OR REPLACE FUNCTION processing_controls_no_reactivate() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'LIFTED' THEN
    RAISE EXCEPTION 'processing_controls: a lifted control cannot be modified';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER processing_controls_no_reactivate
  BEFORE UPDATE ON "processing_controls"
  FOR EACH ROW EXECUTE FUNCTION processing_controls_no_reactivate();
