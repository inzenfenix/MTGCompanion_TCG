-- ROADMAP.md O14 (Actividad N°4): RBAC role, adult declaration instead of a
-- birth date, pseudonymized append-only audit log.

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('USER', 'SUPPORT', 'ADMIN');

-- AlterTable
ALTER TABLE "users"
  ADD COLUMN "role" "user_role" NOT NULL DEFAULT 'USER',
  ADD COLUMN "adultConfirmedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorPseudonym" TEXT NOT NULL,
    "actorRole" "user_role" NOT NULL,
    "action" TEXT NOT NULL,
    "targetPseudonym" TEXT,
    "reason" TEXT,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- Database-level control, not just application logic: once written, an
-- audit entry can't be edited or erased through any connection — not even a
-- compromised backend, a bug, or someone with the app's DB credentials
-- running psql. Only the table owner can drop this trigger, on purpose
-- (src/scripts/anonymize-db.ts does, and only on a dev copy).
CREATE FUNCTION "audit_logs_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_no_update_delete"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_append_only"();

CREATE TRIGGER "audit_logs_no_truncate"
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_logs_append_only"();
