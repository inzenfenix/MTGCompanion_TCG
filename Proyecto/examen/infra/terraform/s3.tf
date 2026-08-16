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
