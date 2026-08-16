# backend_url is THE hand-off value: paste it into trading-app-ionic/.env's
# VITE_API_BASE_URL and backend/.env's PUBLIC_API_URL, then rebuild
# (npm run build -> npx cap sync android -> gradlew assembleDebug). See
# README.md's "After apply" section.

output "backend_public_ip" {
  value = aws_instance.backend.public_ip
}

output "backend_public_dns" {
  value = aws_instance.backend.public_dns
}

output "backend_url" {
  value = "http://${aws_instance.backend.public_ip}:3000"
}

output "postgres_private_ip" {
  value = aws_instance.postgres.private_ip
}

output "mailhog_private_ip" {
  value = aws_instance.mailhog.private_ip
}

output "mailhog_web_ui_url" {
  description = "Only reachable from admin_cidr — view test emails during a demo."
  value       = "http://${aws_instance.mailhog.public_ip}:8025"
}

output "minio_private_ip" {
  value = var.use_minio ? aws_instance.minio[0].private_ip : null
}

output "s3_bucket_name" {
  value = var.use_minio ? null : aws_s3_bucket.card_photos[0].bucket
}

output "s3_bucket_region" {
  value = var.use_minio ? null : var.aws_region
}

output "secrets_manager_secret_arns" {
  value = {
    postgres_password          = aws_secretsmanager_secret.postgres_password.arn
    jwt_secret                 = aws_secretsmanager_secret.jwt_secret.arn
    mercadopago_access_token   = aws_secretsmanager_secret.mercadopago_access_token.arn
    mercadopago_webhook_secret = aws_secretsmanager_secret.mercadopago_webhook_secret.arn
  }
}
