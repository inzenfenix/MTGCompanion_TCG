#!/bin/bash
# Pushes Proyecto/examen/backend/ to the live backend EC2 instance, writes a
# real .env from Secrets Manager + `terraform output`, and (re)builds/runs
# the Docker container. Run by hand after a real `terraform apply` — this
# is deliberately NOT baked into ec2_backend.tf's user_data (a git-clone
# with embedded auth would sit in plaintext instance metadata). Re-runnable:
# this is also how a new backend version gets pushed later, not just first
# deploy.
#
# Requires: a real `terraform apply` already done in this directory, SSH
# access to the backend instance (EC2 key pair), local `aws`/`terraform`/
# `python3` on PATH. Uses `tar | ssh | tar` instead of `rsync` — rsync isn't
# available in Git Bash on Windows, `ssh`/`scp`/`tar` are on every platform
# this project targets.
#
# Usage: ./deploy-backend.sh /path/to/ec2-key.pem [ssh_user]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TERRAFORM_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$(cd "$TERRAFORM_DIR/../../backend" && pwd)"

SSH_KEY="${1:?Usage: deploy-backend.sh /path/to/ec2-key.pem [ssh_user]}"
SSH_USER="${2:-ec2-user}"

cd "$TERRAFORM_DIR"

HOST=$(terraform output -raw backend_public_ip)
BACKEND_URL=$(terraform output -raw backend_url)
POSTGRES_IP=$(terraform output -raw postgres_private_ip)
MAILHOG_IP=$(terraform output -raw mailhog_private_ip)
S3_BUCKET=$(terraform output -raw s3_bucket_name 2>/dev/null || echo "")
S3_REGION=$(terraform output -raw s3_bucket_region 2>/dev/null || echo "")

SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new $SSH_USER@$HOST"
SCP="scp -i $SSH_KEY -o StrictHostKeyChecking=accept-new"

echo "==> Deploying backend to $HOST"

# ── 1. Ship the source tree (tar over ssh — rsync-equivalent, no rsync dep) ──
echo "==> Copying backend/ source"
$SSH "mkdir -p ~/mtg-backend"
tar czf - -C "$BACKEND_DIR" \
  --exclude node_modules --exclude dist --exclude generated \
  --exclude coverage --exclude .git --exclude test \
  . | $SSH "tar xzf - -C ~/mtg-backend"
$SCP "$BACKEND_DIR/Dockerfile" "$BACKEND_DIR/.dockerignore" "$BACKEND_DIR/docker-entrypoint.sh" \
  "$SSH_USER@$HOST:~/mtg-backend/"

# ── 2. Resolve app secrets from Secrets Manager (local aws cli, this ──
# machine's own credentials — never written to a file) and write a real
# .env on the remote instance.
echo "==> Resolving secrets from Secrets Manager"
SECRETS_OUT=$(python3 - "$TERRAFORM_DIR" <<'PY'
import json, subprocess, sys
tf_dir = sys.argv[1]
arns = json.loads(subprocess.check_output(["terraform", "output", "-json", "secrets_manager_secret_arns"], cwd=tf_dir))
def fetch(arn):
    out = subprocess.check_output(["aws", "secretsmanager", "get-secret-value", "--secret-id", arn, "--query", "SecretString", "--output", "text"])
    return out.decode().strip()
print(fetch(arns["postgres_password"]), fetch(arns["jwt_secret"]), fetch(arns["mercadopago_access_token"]) or "-", fetch(arns["mercadopago_webhook_secret"]) or "-")
PY
)
read -r PG_PW JWT_SECRET MP_TOKEN MP_WEBHOOK <<< "$SECRETS_OUT"
[ "$MP_TOKEN" = "-" ] && MP_TOKEN=""
[ "$MP_WEBHOOK" = "-" ] && MP_WEBHOOK=""

ENV_FILE=$(mktemp)
cat >"$ENV_FILE" <<EOF
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
# STORAGE_ACCESS_KEY_ID/SECRET deliberately left unset — storage.service.ts
# falls through to the instance's LabInstanceProfile role (see that file's
# comment). STORAGE_ENDPOINT/STORAGE_FORCE_PATH_STYLE also unset -> real S3.

$SCP "$ENV_FILE" "$SSH_USER@$HOST:~/mtg-backend/.env"
rm -f "$ENV_FILE"

# ── 3. Build + (re)start the container on the remote ──────────────────────
echo "==> Building and starting the container on $HOST"
$SSH "cd ~/mtg-backend && docker build -t mtg-backend . && docker rm -f mtg-backend-app 2>/dev/null || true; docker run -d --name mtg-backend-app --restart unless-stopped -p 3000:3000 --env-file .env mtg-backend"

echo "==> Done. Backend should be reachable at $BACKEND_URL"
