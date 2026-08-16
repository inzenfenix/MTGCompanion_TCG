#!/bin/bash
# MailHog (SES replacement — AWS Academy Lab accounts commonly block/sandbox
# real SES send access). Fully self-contained, no secrets needed.
set -euo pipefail

if ! command -v docker &>/dev/null; then
  dnf install -y docker
  systemctl enable --now docker
fi

docker rm -f mtg-mailhog 2>/dev/null || true
docker run -d --name mtg-mailhog --restart unless-stopped \
  -p 1025:1025 -p 8025:8025 \
  mailhog/mailhog
