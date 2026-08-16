# Secrets Manager is the one extra managed AWS service (beyond EC2/S3) this
# stack wires in for real — SNS/SQS/DynamoDB/Cognito stay informational-only
# in the Deploy tab's checklist (ROADMAP.md workstream I, no current
# integration point in this app). Instances fetch these via
# `aws secretsmanager get-secret-value` using their attached
# LabInstanceProfile role at boot (see user_data/*.sh.tpl) — never a static
# key pair, never templated into user_data in plaintext.

resource "aws_secretsmanager_secret" "postgres_password" {
  name        = "${var.project_name}/postgres_password"
  description = "Password for the 'mtg' Postgres role."
}

resource "aws_secretsmanager_secret_version" "postgres_password" {
  secret_id     = aws_secretsmanager_secret.postgres_password.id
  secret_string = var.postgres_password
}

resource "aws_secretsmanager_secret" "jwt_secret" {
  name        = "${var.project_name}/jwt_secret"
  description = "JWT signing secret for the backend."
}

resource "aws_secretsmanager_secret_version" "jwt_secret" {
  secret_id     = aws_secretsmanager_secret.jwt_secret.id
  secret_string = var.jwt_secret
}

resource "aws_secretsmanager_secret" "mercadopago_access_token" {
  name        = "${var.project_name}/mercadopago_access_token"
  description = "MercadoPago Checkout Pro access token (blank = NoopPaymentProvider fallback)."
}

resource "aws_secretsmanager_secret_version" "mercadopago_access_token" {
  secret_id     = aws_secretsmanager_secret.mercadopago_access_token.id
  secret_string = var.mercadopago_access_token
}

resource "aws_secretsmanager_secret" "minio_root_user" {
  count       = var.use_minio ? 1 : 0
  name        = "${var.project_name}/minio_root_user"
  description = "MinIO root username (only relevant when use_minio=true)."
}

resource "aws_secretsmanager_secret_version" "minio_root_user" {
  count         = var.use_minio ? 1 : 0
  secret_id     = aws_secretsmanager_secret.minio_root_user[0].id
  secret_string = var.minio_root_user
}

resource "aws_secretsmanager_secret" "minio_root_password" {
  count       = var.use_minio ? 1 : 0
  name        = "${var.project_name}/minio_root_password"
  description = "MinIO root password (only relevant when use_minio=true)."
}

resource "aws_secretsmanager_secret_version" "minio_root_password" {
  count         = var.use_minio ? 1 : 0
  secret_id     = aws_secretsmanager_secret.minio_root_password[0].id
  secret_string = var.minio_root_password
}

resource "aws_secretsmanager_secret" "mercadopago_webhook_secret" {
  name        = "${var.project_name}/mercadopago_webhook_secret"
  description = "MercadoPago webhook signature secret."
}

resource "aws_secretsmanager_secret_version" "mercadopago_webhook_secret" {
  secret_id     = aws_secretsmanager_secret.mercadopago_webhook_secret.id
  secret_string = var.mercadopago_webhook_secret
}
