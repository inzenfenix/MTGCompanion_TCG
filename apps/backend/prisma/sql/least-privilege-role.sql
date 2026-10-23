-- ROADMAP.md O14 (docs/security/ACTIVIDAD_4.md §3/§4) — least privilege at
-- the database level, so the controls don't depend only on the API code.
--
-- Two database identities instead of one all-powerful user:
--   * the OWNER (POSTGRES_USER, e.g. "mtg") — owns the tables, runs
--     `prisma migrate deploy` and the operator scripts. Not used by the
--     running API.
--   * "mtg_app" — what the running API should connect as. Can read and write
--     rows, but can't change the schema (no CREATE/ALTER/DROP), can't touch
--     the migrations bookkeeping, and can only INSERT/SELECT the audit log
--     (on top of the append-only trigger, which also binds the owner).
--
-- Run as the owner, after migrations, then set the password out of band:
--   psql "$DATABASE_URL" -f prisma/sql/least-privilege-role.sql
--   psql "$DATABASE_URL" -c "ALTER ROLE mtg_app PASSWORD '<from Secrets Manager>'"
-- Idempotent. NOT yet wired into infra/terraform/scripts/deploy-backend.sh
-- (the API there still connects as the owner) — see ACTIVIDAD_4.md §6.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mtg_app') THEN
    CREATE ROLE mtg_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO mtg_app', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO mtg_app;
REVOKE CREATE ON SCHEMA public FROM mtg_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Ordinary application tables: row-level read/write only.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mtg_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mtg_app;

-- Audit log: append and read, nothing else.
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_logs" FROM mtg_app;

-- Prisma's migration history is the owner's business only.
REVOKE ALL ON "_prisma_migrations" FROM mtg_app;

-- The catalog is written only by the offline import script (as the owner).
REVOKE INSERT, UPDATE, DELETE ON "catalog_cards" FROM mtg_app;
