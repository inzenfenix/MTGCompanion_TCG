#!/bin/sh
set -e
npx prisma migrate deploy --config prisma.config.ts
# Encrypt any user_settings value still in plaintext / under a retired key
# (ROADMAP.md O2/O3) — idempotent, a no-op once every row is current.
node dist/scripts/encrypt-existing-fields.js
exec node dist/main
