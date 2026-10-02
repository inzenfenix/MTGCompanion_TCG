# backend_url is THE hand-off value: paste it into apps/mobile/.env's
# VITE_API_BASE_URL and backend/.env's PUBLIC_API_URL, then rebuild
# (npm run build -> npx cap sync android -> gradlew assembleDebug). See
# README.md's "After apply" section.

# Instance IDs — no puertos administrativos abiertos en ningún SG (ver
# security_groups.tf), todo acceso admin es vía SSM Session Manager
# (`aws ssm start-session --target <id>`, desktop-runner's Deploy tab tiene
# botones para esto). deploy-backend.sh también los usa para el
# `ssm send-command` que reemplazó al viejo flujo SSH/SCP.
output "backend_instance_id" {
  value = aws_instance.backend.id
}

output "postgres_instance_id" {
  value = aws_instance.postgres.id
}

output "mailhog_instance_id" {
  value = aws_instance.mailhog.id
}

output "minio_instance_id" {
  value = var.use_minio ? aws_instance.minio[0].id : null
}

output "backend_public_ip" {
  value = aws_eip.backend.public_ip
}

output "backend_public_dns" {
  value = aws_instance.backend.public_dns
}

output "backend_url" {
  value = "http://${aws_eip.backend.public_ip}:3000"
}

output "postgres_private_ip" {
  value = aws_instance.postgres.private_ip
}

output "mailhog_private_ip" {
  value = aws_instance.mailhog.private_ip
}

output "mailhog_web_ui_url" {
  description = "Not directly reachable (no inbound admin ports) — this is the URL your local traffic hits AFTER you open an SSM port-forward tunnel to mailhog_instance_id:8025 (desktop-runner Deploy tab, or `aws ssm start-session --target <mailhog_instance_id> --document-name AWS-StartPortForwardingSession --parameters portNumber=8025,localPortNumber=8025`)."
  value       = "http://localhost:8025"
}

output "minio_private_ip" {
  value = var.use_minio ? aws_instance.minio[0].private_ip : null
}

output "minio_console_url" {
  description = "Same deal as mailhog_web_ui_url — only reachable after an SSM port-forward tunnel to minio_instance_id:9001. Null when use_minio=false (no MinIO instance exists)."
  value       = var.use_minio ? "http://localhost:9001" : null
}

output "aws_region" {
  description = "So scripts/deploy-backend.sh doesn't have to re-derive this — the region terraform itself deployed into."
  value       = var.aws_region
}

output "deploy_artifacts_bucket_name" {
  description = "Staging bucket for scripts/deploy-backend.sh — unrelated to card_photos/use_minio, see s3.tf."
  value       = aws_s3_bucket.deploy_artifacts.bucket
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
    field_encryption_key       = aws_secretsmanager_secret.field_encryption_key.arn
    mercadopago_access_token   = aws_secretsmanager_secret.mercadopago_access_token.arn
    mercadopago_webhook_secret = aws_secretsmanager_secret.mercadopago_webhook_secret.arn
  }
}
