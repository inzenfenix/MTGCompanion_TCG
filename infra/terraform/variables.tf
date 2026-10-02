# ── AWS credentials ──────────────────────────────────────────────────────
# No aws_access_key_id/aws_secret_access_key/aws_session_token variables
# here on purpose (removed 19 ago) — providers.tf no longer wires any
# variable into the AWS provider block, it relies on the default credential
# chain (ambient AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_SESSION_TOKEN
# env vars) instead, same as every other AWS-touching command in this
# project. See providers.tf's own header comment for why: a Terraform
# variable here meant a *.tfvars file could set one too, and *.tfvars
# silently outranks TF_VAR_* env-var injection — a real footgun that was
# hit in practice, not just theoretical. Terraform itself is still run
# locally (desktop-runner's Deploy tab, or by hand with AWS_* exported in
# your shell) — anything running ON an EC2 instance (backend's S3 calls,
# any instance's Secrets Manager fetch) instead uses the attached
# LabInstanceProfile via the SDK's default credential chain — see
# storage.service.ts. That split is unchanged, only how Terraform itself
# gets credentials changed.

variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "us-east-1"
}

variable "instance_profile_name" {
  description = "Name of the pre-existing IAM instance profile to attach to every EC2 instance (AWS Academy Lab accounts provide 'LabInstanceProfile', wrapping 'LabRole')."
  type        = string
  default     = "LabInstanceProfile"
}

# ── Project naming ───────────────────────────────────────────────────────
variable "project_name" {
  description = "Short name prefixed onto every resource's Name tag / S3 bucket name."
  type        = string
  default     = "mtg-companion"
}

# ── Storage backend choice ───────────────────────────────────────────────
variable "use_minio" {
  description = "true = self-host MinIO on its own EC2 instance instead of using real S3. Default false (real S3 — zero backend code changes needed, cheaper, one less box). Mirrors the Deploy tab's S3-vs-MinIO checklist toggle; toggling the UI checkbox does NOT auto-apply this."
  type        = bool
  default     = false
}

# ── Instance sizing ──────────────────────────────────────────────────────
# t3.medium is a hard ceiling (AWS Academy Lab account restriction) — the
# allow-list below blocks any accidental non-t3 or oversized typo, not just
# "<= medium".
variable "instance_type_postgres" {
  type    = string
  default = "t3.small"
  validation {
    condition     = contains(["t3.micro", "t3.small", "t3.medium"], var.instance_type_postgres)
    error_message = "instance_type_postgres must be one of t3.micro, t3.small, t3.medium."
  }
}

variable "instance_type_mailhog" {
  type    = string
  default = "t3.micro"
  validation {
    condition     = contains(["t3.micro", "t3.small", "t3.medium"], var.instance_type_mailhog)
    error_message = "instance_type_mailhog must be one of t3.micro, t3.small, t3.medium."
  }
}

variable "instance_type_minio" {
  type    = string
  default = "t3.small"
  validation {
    condition     = contains(["t3.micro", "t3.small", "t3.medium"], var.instance_type_minio)
    error_message = "instance_type_minio must be one of t3.micro, t3.small, t3.medium."
  }
}

variable "instance_type_backend" {
  type    = string
  default = "t3.small"
  validation {
    condition     = contains(["t3.micro", "t3.small", "t3.medium"], var.instance_type_backend)
    error_message = "instance_type_backend must be one of t3.micro, t3.small, t3.medium."
  }
}

# ── MinIO credentials (only relevant when use_minio=true) ───────────────
variable "minio_root_user" {
  description = "MinIO root username. Only used when use_minio=true."
  type        = string
  default     = "mtg_minio_admin"
  sensitive   = true
}

variable "minio_root_password" {
  description = "MinIO root password. Only used when use_minio=true."
  type        = string
  default     = "change-me-minio"
  sensitive   = true
}

# ── App secrets (fed into Secrets Manager, see secrets.tf) ──────────────
variable "postgres_password" {
  description = "Password for the 'mtg' Postgres role, self-hosted in Docker on the postgres instance."
  type        = string
  sensitive   = true
}

variable "jwt_secret" {
  description = "JWT signing secret for the backend (JWT_SECRET env var)."
  type        = string
  sensitive   = true
}

variable "field_encryption_key" {
  description = "AES-256-GCM key for field-level encryption of player data (FIELD_ENCRYPTION_KEY env var, ROADMAP.md O1-O4). 32 random bytes, base64 — generate with `openssl rand -base64 32`. Losing it makes the encrypted columns unreadable; rotating it needs the retired key kept around (see backend config/configuration.ts)."
  type        = string
  sensitive   = true
  validation {
    condition     = can(base64decode(var.field_encryption_key)) && length(base64decode(var.field_encryption_key)) == 32
    error_message = "field_encryption_key must be 32 bytes, base64-encoded (openssl rand -base64 32)."
  }
}

variable "mercadopago_access_token" {
  description = "MercadoPago Checkout Pro access token. Leave blank to keep MercadoPago-method transactions on NoopPaymentProvider (CASH always works regardless)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "mercadopago_webhook_secret" {
  description = "MercadoPago webhook signature secret, from 'Tus integraciones' dashboard."
  type        = string
  default     = ""
  sensitive   = true
}
