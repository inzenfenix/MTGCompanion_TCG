# syntax=docker/dockerfile:1
#
# 3-stage build for the NestJS backend. No dev/prod dependency split: the
# `prisma` CLI is a devDependency but is needed at container start for
# `prisma migrate deploy` (see docker-entrypoint.sh) — reclassifying it in
# package.json is a future slimming step, not done here. All secrets (DB,
# storage, JWT, MercadoPago) are supplied at `docker run` time via an
# --env-file, never baked in as a Dockerfile ENV.
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate --config prisma.config.ts && npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist         ./dist
COPY --from=build /app/generated    ./generated
COPY package.json prisma.config.ts  ./
COPY prisma                         ./prisma
COPY docker-entrypoint.sh           ./
RUN chmod +x docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
