# Least-privilege, SG-to-SG ingress only — the one deliberate exception is
# sg_backend's port 3000, which has to be reachable from anywhere (the
# Android app connects from an arbitrary network). Every other cross-service
# path (backend -> postgres, backend -> mailhog, backend -> minio) is scoped
# to "traffic whose source is that other service's security group", never
# an open CIDR. All four allow all egress (docker/dnf pulls, Secrets
# Manager, S3 — none of those have a fixed, safely-allowlistable IP range).

resource "aws_security_group" "backend" {
  name        = "${var.project_name}-backend"
  description = "NestJS backend instance — 3000 open to the internet (Android app), 22 admin-only."
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "App API — must be reachable from any network (Android client)."
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "SSH — admin only."
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.admin_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-backend" }
}

resource "aws_security_group" "postgres" {
  name        = "${var.project_name}-postgres"
  description = "Postgres instance — 5432 only from the backend's SG, 22 admin-only."
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "Postgres — backend only."
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.backend.id]
  }

  ingress {
    description = "SSH — admin only."
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.admin_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-postgres" }
}

resource "aws_security_group" "mailhog" {
  name        = "${var.project_name}-mailhog"
  description = "MailHog instance (SES replacement) — SMTP 1025 only from the backend's SG, web UI 8025 + SSH admin-only."
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "SMTP — backend only."
    from_port       = 1025
    to_port         = 1025
    protocol        = "tcp"
    security_groups = [aws_security_group.backend.id]
  }

  ingress {
    description = "MailHog web UI — admin only, to view test emails during a demo."
    from_port   = 8025
    to_port     = 8025
    protocol    = "tcp"
    cidr_blocks = [var.admin_cidr]
  }

  ingress {
    description = "SSH — admin only."
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.admin_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-mailhog" }
}

# Conditionally created — only exists when var.use_minio is true (default
# false, real S3 preferred). Referenced with a splat/index elsewhere
# (ec2_minio.tf, ec2_backend.tf's user_data) guarded by the same condition.
resource "aws_security_group" "minio" {
  count       = var.use_minio ? 1 : 0
  name        = "${var.project_name}-minio"
  description = "MinIO instance (S3 replacement, opt-in) — API 9000 only from the backend's SG, console 9001 + SSH admin-only."
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "MinIO S3 API — backend only."
    from_port       = 9000
    to_port         = 9000
    protocol        = "tcp"
    security_groups = [aws_security_group.backend.id]
  }

  ingress {
    description = "MinIO console — admin only."
    from_port   = 9001
    to_port     = 9001
    protocol    = "tcp"
    cidr_blocks = [var.admin_cidr]
  }

  ingress {
    description = "SSH — admin only."
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.admin_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-minio" }
}
