# AWS infra — Terraform

Stands up a real, always-on backend on AWS so the Android APK (built in
ROADMAP.md's E3d) has a real server to talk to, instead of
`http://localhost:3000`. See `../PLAN.md` for the full design rationale and
`ROADMAP.md` workstream I for status.

Four single-purpose EC2 instances (`postgres`, `mailhog`, `minio`
[optional], `backend`), connected by security-group-to-security-group
references — never open CIDRs between them, except the backend's port 3000
(has to be reachable from an arbitrary Android device).

## Prerequisites

- Terraform >= 1.5, AWS CLI v2 — both already installed on this dev machine
  (`terraform version` / `aws --version`).
- Real AWS credentials. If this targets an **AWS Academy Learner Lab**
  account: open the lab, click "AWS Details", copy the Access key ID,
  Secret access key, and **Session Token** (all three — Academy Lab
  credentials are temporary and need the session token; they expire every
  ~4 hours, so you'll re-copy these periodically).

## First-time setup

```bash
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars: paste your credentials, set real
# postgres_password/jwt_secret.
terraform init
terraform validate
terraform plan
```

`terraform.tfvars` is gitignored — it holds live credentials/secrets, never
commit it. `plan` needs valid credentials (it resolves the default
VPC/AMI) but makes no changes; it's safe to run freely. **`apply` is not**
— it creates real, billable, outward-facing resources. Run it deliberately:

```bash
terraform apply
```

## After `apply` — the hand-off to the rest of the app

1. `terraform output backend_url` — this is the value that unblocks
   everything else.
2. Deploy the backend app itself (Terraform only provisions the instances +
   installs Docker on `backend`; it doesn't ship the app):
   ```bash
   ./scripts/deploy-backend.sh
   ```
   No SSH key needed — it stages the source through the
   `deploy_artifacts_bucket_name` S3 bucket and builds/runs it via `aws ssm
   send-command` (Run Command), using this machine's own AWS credentials
   (not the instance's role) same as `terraform apply` itself. Re-run this
   any time you want to push a new backend version — it's idempotent, not
   just a first-deploy step.
3. Point the Android build at the real server:
   - `trading-app-ionic/.env`: `VITE_API_BASE_URL=<terraform output backend_url>`
   - `backend`'s remote `.env` already gets `PUBLIC_API_URL` set by
     `deploy-backend.sh` (needed for MercadoPago's webhook callback).
   - Replace the placeholder host in
     `trading-app-ionic/android/app/src/main/res/xml/network_security_config.xml`
     with the real EC2 host (Android blocks plaintext HTTP by default;
     that file's cleartext exception only covers the placeholder as
     committed — a real TLS setup, see below, would remove the need for
     this entirely).
   - Rebuild: `npm run build` → `npx cap sync android` → `cd android &&
     ./gradlew assembleDebug`.
4. One-time catalog import (not part of `user_data` — a 58k-row import
   shouldn't block instance boot). Easiest: desktop-runner's Deploy tab →
   Outputs card → "3. Importar catálogo" (uploads `certamen_1/data/
   cards.json` to `deploy_artifacts_bucket_name` and runs it remotely via
   SSM Run Command, no shell needed). Doing it by hand instead needs two
   real gotchas worked around, both found running this for real against a
   live instance:
   - `certamen_1/data/cards.json` isn't on the instance (only `backend/`
     gets shipped) — copy it in yourself first (`docker cp` after getting it
     onto the instance somehow, e.g. via the same S3-staging trick
     `deploy-backend.sh` uses).
   - `npm run db:import-catalog` (`ts-node prisma/import-catalog.ts`) fails
     with `ERR_UNKNOWN_FILE_EXTENSION` as-is — `tsconfig.json`'s `"module":
     "nodenext"` makes Node's own ESM loader grab the `.ts` file before
     ts-node's CommonJS hook can. Fix: run it with
     `TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}'` set, and via
     `node_modules/.bin/ts-node` directly (not the `npm run` wrapper), e.g.
     `docker exec -e TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}'
     mtg-backend-app node_modules/.bin/ts-node -r dotenv/config
     prisma/import-catalog.ts --file /path/to/cards.json`. Then `npm run
     db:seed` if needed (same fix likely applies — not hit yet, `db:seed`
     wasn't run this session).

## Admin access (SSM Session Manager, no SSH)

No instance has any inbound admin port open — no SSH, no admin-web CIDR
rule (see `security_groups.tf`'s header comment for why). Every instance is
reached exclusively through **AWS Systems Manager Session Manager**, which
this account's `LabRole` already supports (`AmazonSSMManagedInstanceCore`
is attached) — no bastion host, no SSH key pair, no open ports, IAM-
authenticated and CloudTrail-audited. desktop-runner's Deploy tab has
"Abrir terminal"/"Abrir túnel" buttons for this; from a plain terminal,
after installing the [Session Manager
plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)
(desktop-runner can also install this one automatically):

```bash
# Interactive shell on any instance:
aws ssm start-session --target $(terraform output -raw backend_instance_id)

# Tunnel a web UI (MailHog) to localhost — same idea for MinIO's console on 9001:
aws ssm start-session --target $(terraform output -raw mailhog_instance_id) \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["8025"],"localPortNumber":["8025"]}'
# then open http://localhost:8025
```

## MinIO vs. real S3

Default is real S3 (`use_minio = false` in `terraform.tfvars`) — zero
backend code changes needed (`storage.service.ts` is already
endpoint-agnostic), cheaper, one less instance to run. Set `use_minio =
true` to self-host MinIO on its own EC2 instance instead (e.g. if S3
bucket-creation permissions are restricted in your AWS account). Toggling
this requires a real `terraform apply` — it is not a runtime switch.

## TLS / domain

Not built in this pass — the Android app talks to the backend over plain
HTTP via an explicit cleartext exception (dev/course-project only, not
production-appropriate). If a real domain is available, the cheapest
upgrade path is a Caddy reverse-proxy container on the `backend` instance
using a nip.io/sslip.io-style hostname bound to its public IP (automatic
HTTPS, no real domain purchase needed) — a documented future step, not
implemented here.

## Destroying

```bash
terraform destroy
```

**Irreversible** — wipes whatever's on Postgres/S3/MinIO at that point (the
EBS volumes and S3 bucket are destroyed along with the instances). Only run
this deliberately, and only if you're done with the deployed environment.

## Known limitations (v1, documented — not bugs)

- No RDS — Postgres is self-hosted in Docker on its own EC2 instance
  (avoids needing RDS-creation permissions some lab accounts restrict).
  Swapping to RDS later is a small `main.tf`-equivalent change if
  reliability/backups become a real concern.
- No SNS/SQS/DynamoDB/Cognito integration — available in the account, but
  this app has no current use case for them (own JWT auth, no async queue,
  no DynamoDB data model). The desktop-runner Deploy tab's checklist marks
  them informational-only on purpose.
- `terraform.tfvars`'s state file (`terraform.tfstate`, gitignored) can
  contain secrets in plaintext once resources exist — don't share it, don't
  commit it, treat it like a credentials file.
- `terraform.tfvars`'s AWS credential lines silently take precedence over
  `TF_VAR_*` env vars (Terraform's `.tfvars` > env var precedence) — if
  you've edited `terraform.tfvars` by hand in the past, a stale credential
  set in that file will shadow fresh ones injected via env vars (including
  desktop-runner's Deploy tab, which only injects via env vars, never
  writes the file) with a confusing "AccessDenied"-style error that looks
  AWS-side. Fix: keep `terraform.tfvars`'s credential lines in sync with
  whatever's current, or don't hand-edit that file for credentials at all
  once you're driving `terraform` through the Deploy tab (16 ago, found
  live while debugging this).

## Elastic IP (backend)

`backend`'s public IP is an **Elastic IP** (`eip.tf`, `aws_eip.backend` +
`aws_eip_association.backend`), not the instance's default ephemeral one —
added 16 ago after AWS Academy Lab stopped/restarted the instance between
sessions and its ephemeral IP changed (`98.92.218.66` → `100.61.127.188`)
with no `apply` run in between, silently breaking the APK's baked-in
`VITE_API_BASE_URL` and the Android cleartext-exception host. An EIP
survives stop/start — only a `terraform destroy` or instance replacement
changes it now. Trade-off: free while attached to a *running* instance, a
small hourly charge while attached to a *stopped* one (likely between Lab
sessions) or left unassociated — accepted for a course project.
`postgres`/`mailhog`/`minio` don't have one (only reached via SSM, which
targets by instance ID, not IP, so their IPs changing is a non-issue).
