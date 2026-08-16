# ── AWS credentials ──────────────────────────────────────────────────────
# Two separate credential paths exist in this workstream — don't conflate
# them: THESE variables are for Terraform itself (run locally, e.g. via
# TF_VAR_aws_access_key_id env vars or desktop-runner's Deploy tab).
# Anything running ON an EC2 instance (backend's S3 calls, any instance's
# Secrets Manager fetch) instead uses the attached LabInstanceProfile via
# the SDK's default credential chain — see storage.service.ts.
variable "aws_access_key_id" {
  description = "AWS access key id (AWS Academy Lab 'AWS Details' panel, or a normal IAM user's key)."
  type        = string
  sensitive   = true
}

variable "aws_secret_access_key" {
  description = "AWS secret access key, paired with aws_access_key_id."
  type        = string
  sensitive   = true
}

variable "aws_session_token" {
  description = "AWS session token — REQUIRED for AWS Academy Learner Lab credentials (they're temporary, expire ~4h). Leave null for a normal long-lived IAM user."
  type        = string
  default     = null
  sensitive   = true
}

variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "us-east-1"
}

# ── Access control ───────────────────────────────────────────────────────
variable "admin_cidr" {
  description = "CIDR (your own IP, e.g. 203.0.113.4/32) allowed SSH + admin-web access to every instance. No default on purpose — never defaults to 0.0.0.0/0."
  type        = string

  validation {
    condition     = var.admin_cidr != "0.0.0.0/0"
    error_message = "admin_cidr must not be 0.0.0.0/0 — scope it to your own IP."
  }
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
