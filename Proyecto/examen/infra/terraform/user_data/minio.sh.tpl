#!/bin/bash
# Self-hosted MinIO (opt-in via use_minio=true — real S3 is the default and
# preferred path, see s3.tf). Data dir on the attached EBS volume
# (ec2_minio.tf) so a replace doesn't lose uploaded photos.
set -euo pipefail

if ! command -v docker &>/dev/null; then
  dnf install -y docker
  systemctl enable --now docker
fi

# See postgres.sh.tpl's comment — Nitro instances expose the attached
# volume as /dev/nvme1n1, not the requested "${device_name}", and may not
# be attached the instant this boots — retry for up to a minute.
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
  echo "minio.sh.tpl: no attached data volume found after 60s, aborting" >&2
  exit 1
fi
MOUNT_POINT=/data/minio
if ! blkid "$DEVICE" &>/dev/null; then
  mkfs -t ext4 "$DEVICE"
fi
mkdir -p "$MOUNT_POINT"
mount "$DEVICE" "$MOUNT_POINT" || true
grep -q "$DEVICE" /etc/fstab || echo "$DEVICE $MOUNT_POINT ext4 defaults,nofail 0 2" >>/etc/fstab

command -v aws &>/dev/null || (dnf install -y aws-cli || (dnf install -y python3-pip && pip3 install awscli))

MINIO_ROOT_USER=$(aws secretsmanager get-secret-value --region "${aws_region}" --secret-id "${minio_root_user_secret_arn}" --query SecretString --output text)
MINIO_ROOT_PASSWORD=$(aws secretsmanager get-secret-value --region "${aws_region}" --secret-id "${minio_root_password_secret_arn}" --query SecretString --output text)

docker rm -f mtg-minio 2>/dev/null || true
docker run -d --name mtg-minio --restart unless-stopped \
  -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER="$MINIO_ROOT_USER" \
  -e MINIO_ROOT_PASSWORD="$MINIO_ROOT_PASSWORD" \
  -v "$MOUNT_POINT":/data \
  minio/minio server /data --console-address ":9001"
