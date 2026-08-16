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
   shouldn't block instance boot): open a shell on `backend` (see "Admin
   access" below) and run `docker exec mtg-backend-app npm run
   db:import-catalog`, then `npm run db:seed` if needed.

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
