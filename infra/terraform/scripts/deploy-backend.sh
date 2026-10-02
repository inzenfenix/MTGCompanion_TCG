#!/bin/bash
# Pushes apps/backend/ to the live backend EC2 instance, writes a
# real .env from Secrets Manager + `terraform output`, and (re)builds/runs
# the Docker container. Run by hand after a real `terraform apply` — this
# is deliberately NOT baked into ec2_backend.tf's user_data (a git-clone
# with embedded auth would sit in plaintext instance metadata). Re-runnable:
# this is also how a new backend version gets pushed later, not just first
# deploy.
#
# No SSH, no key pair, ever — the backend/postgres/mailhog/minio security
# groups have zero inbound admin ports (see ../security_groups.tf). This
# script instead:
#   1. tars backend/ locally and uploads it to the deploy_artifacts S3
#      bucket (this machine's own AWS credentials, same ones terraform
#      itself uses).
#   2. resolves app secrets from Secrets Manager, same as before, still
#      with this machine's own credentials — the .env content never
#      touches disk on the remote end in plaintext except the final file
#      docker actually reads.
#   3. runs `aws ssm send-command` (Run Command, AWS-RunShellScript) on the
#      backend instance to pull the tar from S3, write the .env, and
#      docker build/run — the instance does that download+decode itself
#      using ITS OWN IAM role (LabInstanceProfile), not this machine's
#      credentials. Polls for completion and prints the remote output.
#
# Requires: a real `terraform apply` already done in this directory, local
# `aws`/`terraform`/`python3` on PATH (desktop-runner's Deploy tab can
# install `aws`/`terraform`; the AWS CLI's `session-manager-plugin` is only
# needed for interactive `aws ssm start-session`, NOT for this script —
# `send-command` doesn't need it).
#
# Usage: ./deploy-backend.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TERRAFORM_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$(cd "$TERRAFORM_DIR/../../apps/backend" && pwd)"

cd "$TERRAFORM_DIR"

INSTANCE_ID=$(terraform output -raw backend_instance_id)
BACKEND_URL=$(terraform output -raw backend_url)
POSTGRES_IP=$(terraform output -raw postgres_private_ip)
MAILHOG_IP=$(terraform output -raw mailhog_private_ip)
ARTIFACTS_BUCKET=$(terraform output -raw deploy_artifacts_bucket_name)
S3_BUCKET=$(terraform output -raw s3_bucket_name 2>/dev/null || echo "")
S3_REGION=$(terraform output -raw s3_bucket_region 2>/dev/null || echo "")
AWS_REGION=$(terraform output -raw aws_region)

echo "==> Deploying backend to instance $INSTANCE_ID (region $AWS_REGION)"

# ── 1. Ship the source tree via S3 (no SSH/SCP — see header) ─────────────
echo "==> Packing and uploading backend/ source"
TMP_TAR=$(mktemp /tmp/mtg-backend-XXXXXX.tar.gz)
trap 'rm -f "$TMP_TAR"' EXIT

tar czf "$TMP_TAR" -C "$BACKEND_DIR" \
  --exclude node_modules --exclude dist --exclude generated \
  --exclude coverage --exclude .git --exclude test \
  .

DEPLOY_KEY="deploys/backend-$(date +%s).tar.gz"
aws s3 cp "$TMP_TAR" "s3://$ARTIFACTS_BUCKET/$DEPLOY_KEY" --region "$AWS_REGION"

# ── 2. Resolve app secrets from Secrets Manager (local aws cli, this ──
# machine's own credentials — never written to a file) and build the .env
# content in memory.
echo "==> Resolving secrets from Secrets Manager"
SECRETS_OUT=$(python3 - "$TERRAFORM_DIR" "$AWS_REGION" <<'PY'
import json, subprocess, sys
tf_dir = sys.argv[1]
aws_region = sys.argv[2]
arns = json.loads(subprocess.check_output(["terraform", "output", "-json", "secrets_manager_secret_arns"], cwd=tf_dir))
def fetch(arn):
    # --region explícito: sin esto, aws cli no tiene de dónde sacar la
    # región acá (ni AWS_DEFAULT_REGION ni un ~/.aws/config con default
    # existen necesariamente en esta máquina) y falla con "NoRegion"
    # (confirmado en una corrida real contra la cuenta real).
    out = subprocess.check_output(["aws", "secretsmanager", "get-secret-value", "--secret-id", arn, "--region", aws_region, "--query", "SecretString", "--output", "text"])
    val = out.decode().strip()
    # "unset" is secrets.tf's sentinel for "the mercadopago_* var was left
    # blank" — Secrets Manager's real API rejects a literal empty
    # SecretString, so terraform stores this instead; translate it back to
    # "" here so the backend's .env ends up blank exactly like before.
    return "" if val == "unset" else val
print(fetch(arns["postgres_password"]), fetch(arns["jwt_secret"]), fetch(arns["mercadopago_access_token"]) or "-", fetch(arns["mercadopago_webhook_secret"]) or "-")
PY
)
read -r PG_PW JWT_SECRET MP_TOKEN MP_WEBHOOK <<< "$SECRETS_OUT"
[ "$MP_TOKEN" = "-" ] && MP_TOKEN=""
[ "$MP_WEBHOOK" = "-" ] && MP_WEBHOOK=""

ENV_CONTENT=$(cat <<EOF
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://mtg:${PG_PW}@${POSTGRES_IP}:5432/mtg_companion?schema=public
STORAGE_REGION=${S3_REGION}
STORAGE_BUCKET=${S3_BUCKET}
EMAIL_PROVIDER=smtp
EMAIL_FROM=MTG Companion <no-reply@mtgcompanion.app>
SMTP_HOST=${MAILHOG_IP}
SMTP_PORT=1025
JWT_SECRET=${JWT_SECRET}
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=30d
MERCADOPAGO_ACCESS_TOKEN=${MP_TOKEN}
MERCADOPAGO_WEBHOOK_SECRET=${MP_WEBHOOK}
PUBLIC_API_URL=${BACKEND_URL}
EOF
)
# STORAGE_ACCESS_KEY_ID/SECRET deliberately left unset — storage.service.ts
# falls through to the instance's LabInstanceProfile role (see that file's
# comment). STORAGE_ENDPOINT/STORAGE_FORCE_PATH_STYLE also unset -> real S3.

# base64, one line, no wrapping — travels as a single Run Command parameter
# without any shell-quoting headaches on the remote end.
ENV_B64=$(printf '%s' "$ENV_CONTENT" | base64 | tr -d '\n')

# ── 3. Build + (re)start the container on the remote, via SSM Run Command ──
# (no SSH — the instance pulls its own source from S3 and decodes its own
# .env using its OWN IAM role, this script's credentials never reach it).
echo "==> Running remote build/deploy via SSM Run Command"
REMOTE_SCRIPT=$(cat <<EOF
set -euo pipefail
mkdir -p ~/mtg-backend
cd ~/mtg-backend
rm -rf app app.tar.gz
aws s3 cp "s3://${ARTIFACTS_BUCKET}/${DEPLOY_KEY}" app.tar.gz --region ${AWS_REGION}
mkdir app
tar xzf app.tar.gz -C app
rm -f app.tar.gz
echo "${ENV_B64}" | base64 -d > app/.env
cd app
docker build -t mtg-backend .
docker rm -f mtg-backend-app 2>/dev/null || true
docker run -d --name mtg-backend-app --restart unless-stopped -p 3000:3000 --env-file .env mtg-backend
EOF
)

# AWS-RunShellScript's `commands` parameter is a JSON array of lines —
# built with python3 (already a hard requirement above, unlike `jq`, which
# isn't guaranteed present in Git Bash on Windows) so newlines/quotes in the
# script get escaped correctly instead of hand-rolling shell-safe JSON.
PARAMS_FILE=$(mktemp /tmp/mtg-deploy-params-XXXXXX.json)
trap 'rm -f "$TMP_TAR" "$PARAMS_FILE"' EXIT
python3 -c '
import json, sys
print(json.dumps({"commands": sys.stdin.read().split("\n")}))
' <<<"$REMOTE_SCRIPT" >"$PARAMS_FILE"

COMMAND_ID=$(aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --parameters "file://$PARAMS_FILE" \
  --region "$AWS_REGION" \
  --query "Command.CommandId" --output text)

echo "==> Command $COMMAND_ID sent, waiting for it to finish ..."
while true; do
  STATUS=$(aws ssm get-command-invocation \
    --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" --region "$AWS_REGION" \
    --query "Status" --output text 2>/dev/null || echo "Pending")
  case "$STATUS" in
    Success) break ;;
    Failed|Cancelled|TimedOut)
      echo "==> Remote command $STATUS — output:"
      aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" --region "$AWS_REGION" \
        --query "{stdout:StandardOutputContent,stderr:StandardErrorContent}" --output json
      exit 1
      ;;
    *) sleep 3 ;;
  esac
done

aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" --region "$AWS_REGION" \
  --query "StandardOutputContent" --output text

echo "==> Done. Backend should be reachable at $BACKEND_URL"
