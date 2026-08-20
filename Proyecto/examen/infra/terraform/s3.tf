# Real S3 bucket for card photos — only created when use_minio=false (the
# default). storage.service.ts is already endpoint-agnostic (STORAGE_ENDPOINT
# unset -> real AWS S3), so this needs zero backend code changes. Private
# (not MinIO-dev's public-read) — the app only ever reaches objects through
# presigned PUT/GET URLs.
resource "aws_s3_bucket" "card_photos" {
  count  = var.use_minio ? 0 : 1
  bucket = "${var.project_name}-card-photos-${data.aws_caller_identity.current.account_id}"

  tags = { Name = "${var.project_name}-card-photos" }
}

data "aws_caller_identity" "current" {}

# Staging area for scripts/deploy-backend.sh — unconditional (unlike
# card_photos above, this exists regardless of use_minio: it's a build
# artifact bucket, not the app's user-facing photo storage, so it shouldn't
# be coupled to that toggle). deploy-backend.sh tars the backend source,
# `aws s3 cp`s it here, then `aws ssm send-command`s the backend instance to
# pull it down and build — replaced the old SSH/SCP flow, which never
# actually had a real key pair wired to these instances (see
# security_groups.tf's comment). Private, no CORS (server-to-server only,
# never touched by a browser), lifecycle rule so old deploy tarballs don't
# pile up across repeated deploys.
resource "aws_s3_bucket" "deploy_artifacts" {
  bucket = "${var.project_name}-deploy-artifacts-${data.aws_caller_identity.current.account_id}"

  tags = { Name = "${var.project_name}-deploy-artifacts" }
}

resource "aws_s3_bucket_public_access_block" "deploy_artifacts" {
  bucket = aws_s3_bucket.deploy_artifacts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "deploy_artifacts" {
  bucket = aws_s3_bucket.deploy_artifacts.id

  # Scoped to deploys/ only (ROADMAP.md M1) — this bucket also now holds
  # models/ (desktop-runner's "Subir modelos ONNX a S3" button, ExportPanel),
  # the canonical latest-ONNX-export location any machine/CI can pull from
  # instead of re-training locally. That prefix deliberately has NO
  # expiration rule: it's meant to persist indefinitely as "whatever was
  # last exported", not get swept the same way transient deploy tarballs do.
  rule {
    id     = "expire-old-deploys"
    status = "Enabled"
    filter { prefix = "deploys/" }
    expiration {
      days = 7
    }
  }
}

resource "aws_s3_bucket_public_access_block" "card_photos" {
  count  = var.use_minio ? 0 : 1
  bucket = aws_s3_bucket.card_photos[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Wildcard origin: the client is a Capacitor/Android WebView app (no fixed
# web origin) plus an Ionic dev server on an arbitrary localhost port during
# development — there's no single real origin to allowlist instead. Only
# PUT (upload) and GET (download) are needed by the presigned-URL flow in
# storage.service.ts.
resource "aws_s3_bucket_cors_configuration" "card_photos" {
  count  = var.use_minio ? 0 : 1
  bucket = aws_s3_bucket.card_photos[0].id

  cors_rule {
    allowed_methods = ["PUT", "GET"]
    allowed_origins = ["*"]
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}
