# Infra — AWS via Terraform

Full plan/context: `Proyecto/examen/infra/PLAN.md` (approved-and-largely-
implemented; treat that file plus `ROADMAP.md` workstream I as canonical —
this is a map, not a restatement). Terraform lives at
`Proyecto/examen/infra/terraform/`.

## What's deployed — one EC2 instance per service

`ec2_backend.tf`, `ec2_mailhog.tf`, `ec2_minio.tf`, `ec2_postgres.tf` — each
service on its own instance, wired together with **security-group-to-
security-group** rules (`security_groups.tf`), not open CIDRs. `eip.tf`
(elastic IP), `s3.tf`, `secrets.tf`, `data.tf`, `outputs.tf`,
`providers.tf`, `variables.tf` round out the module. `scripts/deploy-backend.sh`
and `user_data/*.sh.tpl` are the instance bootstrap scripts.

## AWS Academy Learner Lab constraints (why the shape looks like this)

- **`t3.medium` is a ceiling**, not a mandate — a Learner Lab account
  restriction, not every instance needs to actually be that size.
- **No SES** (paid/blocked in this lab account) — MailHog on its own EC2
  instance replaces it for dev/demo email.
- Confirmed available beyond what's used: SNS, SQS, DynamoDB, Cognito,
  Secrets Manager. These have **no current integration point** in this app
  (own JWT auth, no async queue, no DynamoDB data model) — the Deploy tab
  checklist treats them as informational-only checkboxes, not speculative
  unused infra.

## Credential handling — never in the repo

AWS credentials (temporary access key + secret + session token, rotating
~every 4 hours in a Learner Lab) are **never** written to a file in this
repo. They're used one of two ways:
1. Live, passed as env vars to a Bash-invoked `terraform`/`aws` command.
2. Pasted into `desktop-runner`'s **Deploy tab**, which persists them to
   `~/.mtg-desktop-runner/settings.json` — outside the git working tree,
   same pattern as the existing Roboflow API key.

The Deploy tab is deliberately generic (not named "AWS") — meant to be the
home for any future cloud/deployment credential (MercadoPago production
tokens, another cloud provider, etc.), not a one-off AWS-only widget. See
`okf/apps/desktop-runner.md` for its implementation (built on
`ScriptsService`'s existing process-spawn/stream/kill primitives, same as
Terraform commands themselves).

## Local tooling

Terraform and the AWS CLI are installed **user-local** (no `dnf`/sudo
install), mirroring the no-sudo portable-JDK precedent used for the Android
APK build (root `README.md`) — see `infra/PLAN.md` for exact install steps
if setting up a fresh machine.
