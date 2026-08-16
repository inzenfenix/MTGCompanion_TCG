#!/bin/sh
set -e
npx prisma migrate deploy --config prisma.config.ts
exec node dist/main
