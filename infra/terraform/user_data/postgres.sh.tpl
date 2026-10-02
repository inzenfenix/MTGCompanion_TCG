#!/bin/bash
# Self-hosted Postgres 16 in Docker, mirroring backend/docker/docker-compose.yml's
# local-dev shape. Data dir lives on the attached EBS volume (ec2_postgres.tf) so
# a `terraform apply` that replaces this instance doesn't wipe the DB.
set -euo pipefail

if ! command -v docker &>/dev/null; then
  dnf install -y docker
  systemctl enable --now docker
fi

# t3.* instances are Nitro-based — an attached EBS volume shows up in the OS
# as /dev/nvme1n1, NOT the "${device_name}" name Terraform's attachment
# resource requested (that name is only a hint the EC2 API uses internally
# on Nitro instances). Detect the real device instead of assuming — and
# retry for up to a minute, since aws_volume_attachment can finish applying
# a few seconds after this instance already started booting.
DEVICE=""
for _ in $(seq 1 30); do
  for candidate in /dev/nvme1n1 /dev/xvdf /dev/sdf; do
    if [ -e "$candidate" ]; then
      DEVICE="$candidate"
      break 2
    fi
  done
  sleep 2
done
if [ -z "$DEVICE" ]; then
  echo "postgres.sh.tpl: no attached data volume found after 60s, aborting" >&2
  exit 1
fi
MOUNT_POINT=/data/postgres
if ! blkid "$DEVICE" &>/dev/null; then
  mkfs -t ext4 "$DEVICE"
fi
mkdir -p "$MOUNT_POINT"
mount "$DEVICE" "$MOUNT_POINT" || true
grep -q "$DEVICE" /etc/fstab || echo "$DEVICE $MOUNT_POINT ext4 defaults,nofail 0 2" >>/etc/fstab

# Postgres' own data dir has to be a SUBDIRECTORY of the mount point, never
# the mount point itself — `mkfs.ext4` always creates a `lost+found` at the
# filesystem's root, so `initdb` sees a "non-empty directory" and refuses to
# start (confirmed for real: `mtg-postgres` crash-looped on the first real
# `apply` with exactly that error). `postgres:16-alpine`'s official image
# already runs as the right uid/gid internally, no extra chown needed.
PGDATA_DIR="$MOUNT_POINT/pgdata"
mkdir -p "$PGDATA_DIR"

# Instance-role credentials only (LabInstanceProfile, attached in
# ec2_postgres.tf) — never a static key pair. If the AL2023 "aws-cli"
# package name ever changes, fall back to the pip install.
command -v aws &>/dev/null || (dnf install -y aws-cli || (dnf install -y python3-pip && pip3 install awscli))

PGPASSWORD=$(aws secretsmanager get-secret-value --region "${aws_region}" --secret-id "${postgres_password_secret_arn}" --query SecretString --output text)

docker rm -f mtg-postgres 2>/dev/null || true
docker run -d --name mtg-postgres --restart unless-stopped \
  -p 5432:5432 \
  -e POSTGRES_USER=mtg \
  -e POSTGRES_PASSWORD="$PGPASSWORD" \
  -e POSTGRES_DB=mtg_companion \
  -v "$PGDATA_DIR":/var/lib/postgresql/data \
  postgres:16-alpine
