# ROADMAP workstream I — AWS infra via Terraform + desktop-runner "Deploy" tab

> **Status: plan only, approved by the user, not yet implemented.** Written
> up so it can be picked up in a fresh session/by another teammate without
> re-exploring the codebase — it embeds all research findings inline.

## Context

ROADMAP.md workstream I ("AWS infrastructure via Terraform") was planning-only —
nothing implemented. The user now wants it actually built, with real AWS
Academy Learner Lab credentials in hand (temporary access key + secret +
session token, **rotate every ~4 hours**) and several scope changes beyond
the original ROADMAP plan:

1. A new **"Deploy" tab in desktop-runner** (deliberately generic, not
   "AWS" — meant to be the future home for any cloud/deployment credential
   or workflow: AWS now, potentially MercadoPago production tokens, another
   cloud provider, etc. later) to paste/update rotating AWS credentials at
   any time — a real usability need, not just "store it somewhere."
2. **Max EC2 instance size is t3.medium** (lab account restriction — overrides
   ROADMAP's original t3.micro/small assumption; treat as a ceiling, not a
   mandate that every instance must actually be t3.medium).
3. **No SES** (paid/blocked in this lab account). Confirmed available:
   SNS, SQS, S3, EC2, DynamoDB, Cognito, Secrets Manager.
4. A **checklist in the Deploy tab** of which services run as managed AWS
   services vs. self-hosted on an EC2 instance.
5. **One EC2 instance per service** — MailHog (SES replacement), MinIO-or-S3,
   Postgres, backend — wired together with **security groups doing
   least-privilege, SG-to-SG access**, not open CIDRs.
6. Install **Terraform** (and the AWS CLI) locally — neither is installed on
   the dev machine that scoped this plan (confirmed: `which terraform`/
   `which aws` both fail, Nobara Linux/Fedora-based, dnf5). No sudo
   available without asking, so install both **user-local** (mirrors the
   no-sudo portable-JDK precedent from ROADMAP E3d) rather than via `dnf`.

The AWS credentials given to Claude in chat while scoping this plan were
**never** written to any file in this repo, and never echoed back in any
output. They're only ever meant to be used (a) live, passed as env vars to
a Bash-invoked `terraform`/`aws` command, or (b) pasted by a user into the
new desktop-runner Deploy tab, which persists them to
`~/.mtg-desktop-runner/settings.json` — entirely outside the git working
tree, same as `roboflowApiKey` today.

**Open decision to confirm before finalizing the checklist copy**:
SNS/SQS/DynamoDB/Cognito are available in the lab account but have no
current integration point in this app (own JWT auth, no async queue, no
DynamoDB data model). The recommendation below treats them as
informational-only checkboxes (persisted, no infra effect) rather than
building speculative unused integrations — confirm this is acceptable
before implementing, since it's a real scope decision, not a fact.

## Ground truth from research (already done — don't re-explore, just build)

**desktop-runner** (`Proyecto/examen/desktop-runner`): NestJS server
(`apps/server`, port 4550) + React renderer + Electron shell. Settings live
at `~/.mtg-desktop-runner/settings.json` via `apps/server/src/scripts/
settings.ts`'s `RunnerSettings`/`readSettings()`/`writeSettings()`, exposed
via `GET`/`POST /settings` (`scripts.controller.ts` → `ScriptsService.
getSettings()`/`updateSettings()`, scripts.service.ts:162-170, which
validates shape before `writeSettings()`).

Live command streaming already exists and is **command-agnostic** —
`execAndStream(runId, cmd, args, cwd)` (scripts.service.ts:563-574) and the
fuller `runScript()` (616-735)/`stopRun()` (838-861, POSIX process-group
kill via `detached:true` + `process.kill(-pid,'SIGTERM')`, the ROADMAP D5
fix) are already used for `docker pull/run/commit` in `ensureTfDockerImage()`
(501-560), not just Python scripts — this is the direct template for
`terraform init/plan/apply/destroy`. `tf-docker.ts`'s `probeCommand()`/
`getTfDockerEligibility()` is the template for a `getTerraformEligibility()`
check (consider exporting `probeCommand` for reuse rather than duplicating
it). `LogsGateway` (socket.io) emits `emitLog`/`emitStatus`/etc.; renderer
connects via `getSocket()` in `apps/renderer/src/lib/api.ts:87-94`.

Renderer: `App.tsx`'s `TabValue` union + `TABS` array (lines 27-35) + a
ternary render chain (tabs stay always-mounted, hidden via CSS, so state
survives switching) is where a new `'aws'` tab slots in. `TAB_BUCKETS`
(49-69) is keyed to `RUN_ALL_*` script sequences in `scripts.config.ts` —
Terraform actions aren't `ScriptDef`s, so **don't** force an entry there;
a plain custom status indicator in the new tab is simpler and correct.
Reusable templates: `RoboflowApiKeyBox.tsx` (paste-a-secret box — but see
below, the AWS box needs real differences, not a straight copy);
`ScriptCard.tsx` + `useRunLogs.ts` + `LogConsole.tsx` (Card+Badge+live
log+stop — `useRunLogs` is generic over any `runId` and works unmodified
as long as the server emits matching event shapes); `ArgForm.tsx`'s
`Checkbox` control (from `ui/input.tsx`) for the services checklist.
`apps/renderer/src/lib/types.ts` mirrors every server type 1:1 by
convention ("Mismo shape que X del server").

CLAUDE.md rule 7 (`RUN_ALL_*` sequences live in `scripts.config.ts`)
specifically governs Python-script orchestration; Terraform commands don't
need to fit that shape, but should still live inside `ScriptsService`
(not a parallel service class) since that's already the one place in this
app that owns process spawn/stream/kill — splitting it out would fragment
that responsibility for no benefit.

Root repo `.gitignore` has a **stale** `!Proyecto/certamen_1/desktop-runner/
**/src/lib/` exception — the app actually lives at `Proyecto/examen/
desktop-runner/` now. Don't copy-paste that stale pattern into any new
gitignore rule; flag it as a tangential fix opportunity, don't silently
"fix" it without confirming since it's outside this workstream's scope.

**backend** (`Proyecto/examen/backend`): No Dockerfile anywhere (confirmed
via full-repo search). `docker/docker-compose.yml` is dev-only
(postgres:16-alpine, MinIO, MailHog — no app container; `npm run start:dev`
run by hand). `.env.example` has every var needed: `NODE_ENV`, `PORT`,
`POSTGRES_*`, `DATABASE_URL`, `STORAGE_ENDPOINT`/`STORAGE_FORCE_PATH_STYLE`/
`STORAGE_REGION`/`STORAGE_BUCKET`/`STORAGE_ACCESS_KEY_ID`/
`STORAGE_SECRET_ACCESS_KEY`, `EMAIL_PROVIDER`(smtp default/ses)/
`EMAIL_FROM`/`SMTP_HOST`/`SMTP_PORT`, `JWT_SECRET`/`JWT_ACCESS_TTL`/
`JWT_REFRESH_TTL`, `MERCADOPAGO_ACCESS_TOKEN`/`MERCADOPAGO_WEBHOOK_SECRET`/
`PUBLIC_API_URL`.

`storage.service.ts:25-38` builds its `S3Client` with an **always-explicit**
`credentials` block (defaults to `''`/`''` if unset via `configuration.ts`)
— does NOT fall through to the SDK's default credential chain, unlike
`SesEmailProvider` (`providers/ses-email.provider.ts`, `new SESClient({
region: email.ses.region})`, no explicit `credentials`) which already does.
This sibling pattern in the same codebase proves the fix below is safe, not
novel.

`package.json`: `build`→`nest build`, `start:prod`→`node dist/main`,
`prisma:deploy`→`prisma migrate deploy`. `main.ts:8` `app.enableCors()`
already allows all origins — no change needed. Prisma uses the **WASM
query-compiler** engine (confirmed by inspecting `backend/generated/
prisma`), not a native Rust binary — no glibc/musl binary-target concern
for the Dockerfile. But: `prisma` (the CLI, needed at container start for
`prisma migrate deploy`) is a **devDependency** in `package.json`, and
`generated/prisma` is **gitignored** (must be produced by `npx prisma
generate` inside the Docker build, can't be copied from host). `prisma.
config.ts` (repo root, Prisma 7 config-file style — not classic
`schema.prisma`-only resolution) is what the CLI actually reads for
`schema`/`migrations.path`/`datasource.url`, and must ship in the runtime
image. `dist/` and `generated/` must stay sibling directories at runtime
(confirmed via `tsconfig.build.json`'s `rootDir` — an existing, deliberate
repo constraint, not something this Dockerfile invents).

**trading-app-ionic**: `src/lib/api.ts:11-12` is the *only* place
`VITE_API_BASE_URL` is read (Vite build-time, statically inlined — no
runtime config). No `network_security_config.xml` exists yet; Android
`targetSdkVersion 36` means plaintext HTTP to a new EC2 host is blocked by
default unless this file is added. `capacitor.config.ts` needs no change
(no `server` block, WebView always loads bundled `dist/`). **Confirmed real
gap**: `trading-app-ionic/.gitignore` excludes `.env.local`/
`.env.development.local`/etc. but **not plain `.env`** — since this
workstream's hand-off step is "paste the real backend URL into `.env`,"
add a bare `.env` line to that `.gitignore` as an in-scope fix.

## Architecture decisions

- **Networking**: default VPC + default subnets (`data` sources, not a new
  VPC — Academy Lab accounts typically can't create VPCs but always have a
  default one). IAM: attach the pre-existing `LabInstanceProfile` (wraps
  `LabRole`) by name — a Terraform variable, default `"LabInstanceProfile"`.
- **4 EC2 instances, single-purpose each**, connected by
  security-group-to-security-group references (never open CIDRs between
  them):
  1. `postgres` — Docker Postgres 16-alpine, EBS volume for the data dir
     (survives instance replace). SG: 5432 only from `backend`'s SG; 22
     only from an `admin_cidr` var (no default — must be set explicitly,
     never `0.0.0.0/0`).
  2. `mailhog` — Docker MailHog (the SES replacement). SG: 1025 only from
     `backend`'s SG; 8025 (web UI, to view test emails during a demo) + 22
     only from `admin_cidr`.
  3. `minio` — **conditionally created**, `count = var.use_minio ? 1 : 0`,
     **default `false`**. Recommendation: use real S3 instead — zero
     backend code changes needed (already endpoint-agnostic), cheaper, one
     less box. The Deploy tab's S3-vs-MinIO checklist toggle drives this
     variable directly (documented as such in the UI — ticking it doesn't
     auto-apply). If enabled: EBS volume for `/data`, SG 9000 only from
     `backend`'s SG, 9001+22 only from `admin_cidr`.
  4. `backend` — the NestJS app, containerized (new Dockerfile). SG: 3000
     open to `0.0.0.0/0` (the Android app must reach it from anywhere —
     the one deliberate open CIDR, everything else is SG-to-SG), 22 only
     from `admin_cidr`.
- **S3** (when `use_minio=false`, the default): private bucket (not
  MinIO-dev's public-read), `aws_s3_bucket_cors_configuration` for the
  presigned PUT/GET flow, explicit `aws_s3_bucket_public_access_block`.
- **Secrets Manager**: the one extra managed service actually worth wiring
  in — `aws_secretsmanager_secret`(+version) for `postgres_password`,
  `jwt_secret`, `mercadopago_access_token`/`mercadopago_webhook_secret`.
  Instances fetch via `aws secretsmanager get-secret-value` using the
  instance role — never touches static keys. SNS/SQS/DynamoDB/Cognito
  stay informational-only in the checklist (see "Open decision" above).
- **Two separate credential paths — don't conflate them**:
  1. **Terraform itself** (runs locally) needs the user's pasted temporary
     creds → bridged via `TF_VAR_aws_access_key_id`/`_secret_access_key`/
     `_session_token` env vars passed to the spawned `terraform` process
     (same pattern as `ROBOFLOW_API_KEY` injection today), **not** by
     writing a `terraform.tfvars` file from desktop-runner.
  2. **Anything running ON an EC2 instance** (backend's S3 calls, any
     instance's Secrets Manager fetch) uses `LabInstanceProfile` via the
     SDK default credential chain — auto-refreshing, never expires. This
     is exactly what the `storage.service.ts` tweak enables.
- **Deploy mechanism for the backend app**: not baked into `user_data` (a
  `git clone` with embedded auth would sit in plaintext instance metadata,
  readable via `ec2:DescribeInstanceAttribute`). Instead, a
  `scripts/deploy-backend.sh` (rsync `backend/` + Dockerfile over SSH to
  the backend instance's IP from `terraform output`, write a `.env` from
  Secrets Manager + Terraform outputs, then remote `docker build && docker
  run`), run by hand (or later from the Deploy tab) after `terraform
  apply`, and **re-runnable** — this is also how a new backend version gets
  pushed later, not just first deploy. `postgres`/`mailhog`/`minio` need no
  app deploy — their `user_data` is fully self-contained.
- **Android/TLS**: cheap path only this pass — add
  `network_security_config.xml` with a cleartext exception for a
  placeholder host (swapped for the real EC2 host after `apply`, documented
  in the infra README), wired via `AndroidManifest.xml`, clearly commented
  dev-only. Real TLS (Caddy + nip.io, or a domain+ACM) stays a documented
  future upgrade, not built now.
- **Instance sizing**: `t3.medium` is a ceiling. Recommended defaults:
  `postgres` `t3.small`, `mailhog` `t3.micro` (trivial load), `minio` (if
  enabled) `t3.small`, `backend` `t3.small` (document `t3.medium` as the
  bump-up path — not currently needed, inference is on-device ONNX per
  CLAUDE.md, backend does no heavy compute). Enforce via a Terraform
  `validation` block with a **hard allow-list** `["t3.micro","t3.small",
  "t3.medium"]`, not just "≤ medium" — blocks accidental non-t3 or oversized
  typos.
- **Explicitly not built this pass**: RDS, SNS/SQS/Cognito integration
  code, real TLS/Caddy/domain. **No `terraform apply`/`destroy` runs
  without a separate explicit go-ahead each time** — billable,
  outward-facing, hard-to-reverse. `init`/`validate`/`plan`/`fmt` are safe
  to run as verification.

## File-by-file plan

### 0. Local tooling (do first)
- Install **Terraform** user-local: download the official HashiCorp zip for
  linux_amd64 to `~/.local/bin/terraform` (already on `PATH`), no sudo —
  same no-sudo-portable-binary precedent as E3d's Temurin JDK.
- Install **AWS CLI v2** user-local: download/run the official installer
  bundle with `-i`/`-b` pointed at user-writable dirs (`~/.local/aws-cli`,
  `~/.local/bin`), no sudo.
- Verify both with `terraform version` / `aws --version`.

### 1. Backend
- **`backend/Dockerfile`** (new) — three stages, single shared `npm ci`
  (no dev/prod dependency split — `prisma` CLI is a devDependency needed at
  container start for `migrate deploy`; reclassifying it in `package.json`
  is a documented future slimming step, not done this pass, to avoid an
  unrequested dependency-manifest edit for marginal image-size gain):
  ```dockerfile
  # syntax=docker/dockerfile:1
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
  ```
  `docker-entrypoint.sh`:
  ```sh
  #!/bin/sh
  set -e
  npx prisma migrate deploy --config prisma.config.ts
  exec node dist/main
  ```
  All env vars (DB, storage, JWT, MercadoPago) supplied at `docker run`
  time via an `--env-file` written by `deploy-backend.sh` — the Dockerfile
  declares no secret `ENV`. `node:20-slim` (Debian/glibc) used for every
  stage for base-family consistency, even though Prisma's WASM engine here
  has no glibc/musl binary-mismatch risk on its own.
- **`backend/.dockerignore`** (new): `node_modules`, `dist`, `generated`,
  `coverage`, `test`, `docker`, `.git`, `.env`, `.env.example`, `*.md`.
- **`backend/src/storage/storage.service.ts`** — minimal diff:
  ```diff
       this.client = new S3Client({
         region: storage.region,
         endpoint: storage.endpoint,
         forcePathStyle: storage.forcePathStyle,
  -      credentials: {
  -        accessKeyId: storage.accessKeyId,
  -        secretAccessKey: storage.secretAccessKey,
  -      },
  +      // Only pass explicit static credentials when STORAGE_ACCESS_KEY_ID
  +      // is actually set (local dev against MinIO). Left unset (prod, EC2
  +      // with LabInstanceProfile attached), the SDK falls through to its
  +      // default credential chain (instance role) — same pattern already
  +      // used by SesEmailProvider, auto-refreshing, no manual rotation.
  +      ...(storage.accessKeyId
  +        ? { credentials: { accessKeyId: storage.accessKeyId, secretAccessKey: storage.secretAccessKey } }
  +        : {}),
       });
  ```
  No other file needs to change — `configuration.ts` already defaults both
  to `''` (falsy) when unset.
- **`backend/.env.example`**: add a short prod-mode comment noting
  `STORAGE_ACCESS_KEY_ID`/`SECRET` should stay blank on EC2 to use the
  instance role.

### 2. Terraform — new `Proyecto/examen/infra/terraform/`
```
infra/terraform/
  providers.tf            # provider "aws" reading var.aws_access_key_id/
                           #   secret_access_key/session_token directly
                           #   (sensitive), var.aws_region; required_providers
                           #   aws ~> 5.x, required_version >= 1.5
  variables.tf             # aws_access_key_id/secret_access_key (sensitive,
                           #   required), aws_session_token (sensitive,
                           #   default null, but .tfvars.example notes it's
                           #   REQUIRED for Academy Lab), aws_region
                           #   (default us-east-1), admin_cidr (no default —
                           #   required, never 0.0.0.0/0), instance_profile_name
                           #   (default "LabInstanceProfile"), use_minio
                           #   (default false), instance_type_postgres/
                           #   mailhog/minio/backend (each validated against
                           #   the t3.micro/small/medium allow-list),
                           #   postgres_password/jwt_secret/
                           #   mercadopago_access_token/
                           #   mercadopago_webhook_secret (sensitive),
                           #   project_name (default "mtg-companion")
  data.tf                  # data.aws_vpc.default, data.aws_subnets.default,
                           #   data.aws_ami.amazon_linux (latest AL2023 —
                           #   avoids a hardcoded, region/staleness-prone AMI id)
  security_groups.tf       # sg_postgres, sg_mailhog, sg_minio(count), sg_backend
                           #   — SG-to-SG ingress only, except sg_backend:3000
                           #   from 0.0.0.0/0 (documented exception); all egress
                           #   0.0.0.0/0 (docker/apt pulls, Secrets Manager, S3)
  secrets.tf                # aws_secretsmanager_secret + _version for the
                           #   4 sensitive app values
  s3.tf                      # count = var.use_minio ? 0 : 1; private bucket,
                           #   CORS config, explicit public_access_block
  ec2_postgres.tf             # instance + EBS volume + attachment (data dir),
                           #   iam_instance_profile = var.instance_profile_name,
                           #   user_data = templatefile(postgres.sh.tpl)
  ec2_mailhog.tf                # instance, no EBS needed (disposable mail)
  ec2_minio.tf                    # count = var.use_minio ? 1 : 0, EBS for /data
  ec2_backend.tf                    # instance; user_data installs Docker ONLY
                           #   (no git-clone-with-auth — deploy-backend.sh
                           #   delivers the app image separately)
  outputs.tf                        # backend_public_ip/dns/url, postgres/
                           #   mailhog/minio private ips, s3_bucket_name/region,
                           #   secrets_manager_secret_arns
  terraform.tfvars.example          # committed template, every var documented
                           #   (see exact content below)
  .gitignore                        # terraform.tfvars, *.tfstate*, .terraform/
                           #   — explicitly DO commit .terraform.lock.hcl
                           #   (standard practice), don't sweep it up in a
                           #   lazy ".terraform*" glob
  README.md                          # runbook: getting temp creds from the
                           #   Academy Lab console, init/plan/apply order,
                           #   the "after apply" hand-off (backend_url into
                           #   trading-app-ionic/.env + backend .env's
                           #   PUBLIC_API_URL, then npm run build → npx cap
                           #   sync android → gradlew assembleDebug),
                           #   deploy-backend.sh usage, MinIO-vs-S3 decision
                           #   note, db:seed/db:import-catalog as a manual
                           #   one-time post-deploy step (I8), destroy
                           #   instructions + a warning about state-file secrets
  user_data/
    postgres.sh.tpl                  # install Docker, mount+format EBS
                           #   (idempotent check), fetch password from
                           #   Secrets Manager via instance role (never
                           #   templated in plaintext), docker run postgres
    mailhog.sh.tpl                    # install Docker, docker run mailhog —
                           #   fully self-contained, no secrets
    minio.sh.tpl                       # install Docker, mount EBS, fetch
                           #   root user/password from Secrets Manager,
                           #   docker run minio
    backend.sh.tpl                      # install Docker only
  scripts/
    deploy-backend.sh                    # rsync backend/+Dockerfile to the
                           #   instance (IP from `terraform output -raw
                           #   backend_public_ip`), write .env from Secrets
                           #   Manager + Terraform outputs, remote docker
                           #   build && run (or docker save|ssh docker load
                           #   if the instance is too small to build —
                           #   decide/document in the README). Re-runnable —
                           #   also how new backend versions get pushed.
```

`terraform.tfvars.example` content outline:
```hcl
aws_region             = "us-east-1"
aws_access_key_id      = "ASIA..."           # AWS Academy Lab "AWS Details" panel
aws_secret_access_key  = "..."               # same panel
aws_session_token      = "..."               # same panel — REQUIRED for Academy Lab, expires ~4h
admin_cidr             = "203.0.113.4/32"    # your own IP/32 — never 0.0.0.0/0
instance_profile_name  = "LabInstanceProfile"
use_minio              = false               # true = self-hosted MinIO EC2 instead of real S3
instance_type_postgres = "t3.small"
instance_type_mailhog  = "t3.micro"
instance_type_minio    = "t3.small"
instance_type_backend  = "t3.small"
postgres_password          = "change-me"
jwt_secret                 = "change-me"
mercadopago_access_token   = ""
mercadopago_webhook_secret = ""
```

### 3. desktop-runner — "Deploy" tab

**Server** (`apps/server/src/scripts/`):
- `settings.ts` — extend `RunnerSettings`:
  ```ts
  export interface AwsCredentials {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string | null;   // null for a normal long-lived IAM user
    savedAt: number;               // Date.now() at last save — drives the
                                    // "saved Xh ago, may be stale" UI hint
  }
  export interface AwsServicesChecklist {
    ec2: boolean;             // always true once applied (symmetry/docs)
    s3: boolean;               // true unless useMinio
    secretsManager: boolean;   // I7
    sns: boolean;               // informational only — see "Open decision"
    sqs: boolean;                 // informational only
    dynamodb: boolean;             // informational only
    cognito: boolean;               // informational only
    useMinio: boolean;               // the ONE checkbox with a real infra
                                      // effect — mirrors Terraform's var.use_minio
  }
  export interface RunnerSettings {
    tensorflowExecutionMode: 'venv' | 'docker';
    roboflowApiKey: string | null;
    awsCredentials: AwsCredentials | null;
    awsServicesChecklist: AwsServicesChecklist;
  }
  ```
  `DEFAULTS.awsCredentials = null`, `DEFAULTS.awsServicesChecklist = {
  ec2:true, s3:true, secretsManager:true, sns:false, sqs:false,
  dynamodb:false, cognito:false, useMinio:false }`. Same
  `~/.mtg-desktop-runner/settings.json` file, zero new persistence
  mechanism.
- `terraform.ts` (new, mirrors `tf-docker.ts`) — `getTerraformEligibility()`
  (probes `terraform version`, optionally `aws --version`, reusing
  `probeCommand()` — export it from `tf-docker.ts` rather than duplicating);
  `TERRAFORM_DIR = path.resolve(REPO_ROOT, 'Proyecto/examen/infra/terraform')`;
  `buildTerraformEnv(creds): Record<string,string>` building
  `{TF_VAR_aws_access_key_id, TF_VAR_aws_secret_access_key,
  TF_VAR_aws_session_token}` (token only if non-null) — mirrors the existing
  `ROBOFLOW_API_KEY` env-injection precedent.
- `scripts.service.ts` extension (add methods here, **not** a new service
  class — this is already the one place in the app owning process
  spawn/stream/kill):
  - `runTerraform(action: 'init'|'validate'|'plan'|'apply'|'destroy')` —
    reuses `execAndStream()`'s shape, `cwd: TERRAFORM_DIR`, `env: {
    ...process.env, ...buildTerraformEnv(readSettings().awsCredentials) }`,
    `-auto-approve` only for apply/destroy and only when the request
    carries an explicit confirm flag. Throws `BadRequestException` up front
    if `awsCredentials` is null (same guard-pattern as existing "venv not
    ready" checks). **Must** spawn with `detached: process.platform !==
    'win32'` and register in the existing `children` map so `stopRun()`
    works unmodified (the D5 process-group-kill fix applies here too —
    `apply` can hang).
  - `getTerraformOutputs()` — plain `execFile('terraform', ['output',
    '-json'])` + parse (fast, not streamed — a single quick response, not
    log-worthy), returns `null` (not an error) if no state exists yet.
- `scripts.controller.ts` new routes: `GET /terraform/status` (eligibility),
  `POST /terraform/:action`, `GET /terraform/outputs`. `GET`/`POST
  /settings` need no change — new fields ride through the existing
  `Partial<RunnerSettings>` patch mechanism.

**Renderer** (`apps/renderer/src/`):
- `lib/types.ts` — mirror `AwsCredentials`/`AwsServicesChecklist`, extend
  `RunnerSettings`.
- `lib/api.ts` — add `terraformStatus()`, `runTerraform(action)`,
  `terraformOutputs()`.
- `components/AwsCredentialsBox.tsx` (new — **not** a straight copy of
  `RoboflowApiKeyBox.tsx`, real differences): 3 fields (access key id,
  secret access key masked, session token masked/optional) + Save. New
  **staleness indicator** (the actual point of this box): show `savedAt`
  as relative time with a warning state past ~3.5h (Academy Lab tokens
  expire ~4h). Unlike Roboflow's box (click-to-unlock-then-edit, since its
  key never expires), **default to always showing the update form**
  (access-key-id pre-filled, secret/token fields always blank for re-paste)
  — paste-and-overwrite should be one action, not unlock-then-edit, since
  re-pasting every few hours is the whole use case. Never render the raw
  secret/token back after save; mask access-key-id only (`first4…last4`,
  Roboflow's convention), no partial reveal at all for secret/token.
- `components/AwsServicesChecklist.tsx` (new) — `Checkbox` rows (from
  `ui/input.tsx`, the `ArgForm.tsx` pattern) for EC2/S3/Secrets Manager
  (structurally always-on, shown pre-checked) and SNS/SQS/DynamoDB/Cognito
  (freely toggleable, informational-only, persisted for documentation).
  `useMinio` styled distinctly with an inline note ("changes `terraform.
  tfvars`: `use_minio` — doesn't auto-apply") since it's the one checkbox
  with a real infra effect.
- `components/TerraformActionCard.tsx` (new) — **one card, five buttons**
  (init/validate/plan/apply/destroy sharing one `LogConsole`/`runId`, not
  five separate `ScriptCard`s) borrowing `ScriptCard.tsx`'s
  Card+Badge+`LogConsole`+`useRunLogs` shape unmodified. `apply`/`destroy`
  get an explicit confirm step (dialog or type-to-confirm) and are disabled
  if `awsCredentials` is null or looks stale.
- `components/AwsTab.tsx` (new) — composes the three above + an outputs
  panel (`backend_url` etc. once `terraformOutputs()` is non-null).
- `App.tsx` — add `'aws'` to `TabValue`/`TABS` (label: **"Deploy"**, not
  "AWS" — per the renaming decision) + one new render branch. Do **not**
  add an `aws` entry to `TAB_BUCKETS` (it's keyed to `RUN_ALL_*` script
  sequences; Terraform actions aren't `ScriptDef`s — a custom status
  indicator inside the tab is simpler and correct).

### 4. trading-app-ionic
- `trading-app-ionic/.gitignore` — add a bare `.env` line (confirmed
  missing today).
- `android/app/src/main/res/xml/network_security_config.xml` (new):
  cleartext exception for a placeholder host, commented "replace with the
  real EC2 host after `terraform apply`; dev/course-project only, not
  production-appropriate."
- `AndroidManifest.xml` — add `android:networkSecurityConfig` attribute
  pointing at it.
- Document in the infra README (not code): after `apply`, set
  `VITE_API_BASE_URL` in `.env` + `PUBLIC_API_URL` in the backend's env,
  rebuild (`npm run build` → `npx cap sync android` → `gradlew
  assembleDebug`).

## Order of operations

1. **`storage.service.ts` tweak** — independent, safe to verify first
   against the existing local MinIO dev setup (the "else" branch isn't
   even exercised locally since `STORAGE_ACCESS_KEY_ID` stays set there).
2. **`backend/Dockerfile` + `.dockerignore` + `docker-entrypoint.sh`** —
   independent of Terraform; can be authored in parallel with step 4, just
   can't be exercised fully end-to-end until both exist.
3. **desktop-runner Deploy tab (server + renderer)** — fully independent
   file tree from `infra/terraform/`, build in parallel with step 4.
   Internal order: `settings.ts` → `terraform.ts` → controller routes →
   `types.ts`/`api.ts` → `AwsCredentialsBox` → `AwsServicesChecklist` →
   `TerraformActionCard` → `AwsTab.tsx` → `App.tsx` wiring.
4. **`infra/terraform/*.tf`** — internal order: `providers.tf`+
   `variables.tf` → `data.tf` → `security_groups.tf` (every `ec2_*.tf`
   needs this first) → `secrets.tf` → `s3.tf` → `ec2_postgres.tf`/
   `ec2_mailhog.tf`/`ec2_minio.tf` (any order, independent of each other)
   → `ec2_backend.tf` (references the other 3 instances' SGs, must come
   after) → `outputs.tf` (last) → `user_data/*.sh.tpl` (write alongside
   each `ec2_*.tf`, not after) → `terraform.tfvars.example` + `.gitignore`
   + `README.md` (last, documents the finished thing).
5. **`scripts/deploy-backend.sh`** — needs both the Dockerfile (step 2)
   and `ec2_backend.tf`'s real output shape (step 4); write last, ideally
   after at least one real `apply` so its assumptions about output names
   are verified, not guessed.
6. **`trading-app-ionic` `.gitignore` fix + `network_security_config.xml`**
   — small, independent, do whenever convenient.

Nothing here requires a real `apply` — that stays a separate, explicit
go-ahead, not a step in this list.

## Verification plan

**Can verify now, no money spent:**
- `terraform fmt -check` / `terraform validate` — fully offline.
- `terraform plan` — needs valid credentials (resolves `data.aws_vpc`/
  `data.aws_ami` etc.) but is non-destructive. Pass credentials only as env
  vars to that one Bash call (`TF_VAR_aws_access_key_id=...
  TF_VAR_aws_secret_access_key=... TF_VAR_aws_session_token=... terraform
  plan`), never written to any file — not `terraform.tfvars`, not a script,
  not `.env`.
- `docker build -t mtg-backend-test backend/` locally — confirms the
  multi-stage build works; can even `docker run --env-file
  backend/.env.example` against the **existing local dev Postgres** (via
  `docker-compose.yml`, no AWS involved) to confirm `docker-entrypoint.sh`'s
  `migrate deploy` → `node dist/main` chain actually boots.
- desktop-runner: `npm run build` / `tsc --noEmit` / `eslint` in both
  `apps/server` and `apps/renderer` for all new/changed files.
- Deploy tab manual smoke test without real AWS: `getTerraformEligibility()`
  probes work with zero credentials; credentials-box save/load/staleness
  round-trips fully against local `~/.mtg-desktop-runner/settings.json`
  with dummy values, no real AWS calls involved.

**Explicitly requires a separate go-ahead before running, every time:**
- `terraform apply` — real, billable EC2/EBS/S3/Secrets Manager resources,
  outward-facing (backend SG opens `0.0.0.0/0:3000`).
- `terraform destroy` — irreversible data loss on whatever's on
  Postgres/S3/MinIO at that point.
- `scripts/deploy-backend.sh` against a live instance — pushes real app
  code to a running, billable, publicly-reachable box.
- Any `POST /terraform/apply` or `POST /terraform/destroy` click inside the
  Deploy tab itself — the UI confirm dialog is a UX safety net, not a
  substitute for the assistant-side rule above.

## Note on scope / continuation

This is large (new Terraform stack + a full new desktop-runner tab spanning
server+renderer + a Dockerfile + an Android config file) — expect it to
span more than one session. Update ROADMAP.md's workstream I table with
dated progress notes as pieces land, per this project's existing "always
update ROADMAP.md" convention — don't wait until the whole workstream is
done to touch it.
