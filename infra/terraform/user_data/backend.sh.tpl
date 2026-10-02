#!/bin/bash
# Installs Docker ONLY — deliberately no git-clone-with-embedded-auth here
# (that would sit in plaintext, readable via ec2:DescribeInstanceAttribute).
# The actual app image/code is delivered afterwards by
# scripts/deploy-backend.sh over SSH — run by hand (or later from the
# Deploy tab) after `terraform apply`, and re-runnable for future deploys.
set -euo pipefail

if ! command -v docker &>/dev/null; then
  dnf install -y docker
  systemctl enable --now docker
fi
