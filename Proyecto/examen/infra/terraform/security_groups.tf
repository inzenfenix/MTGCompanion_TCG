# Least-privilege, SG-to-SG ingress only - the one deliberate exception is
# sg_backend's port 3000, which has to be reachable from anywhere (the
# Android app connects from an arbitrary network). Every other cross-service
# path (backend -> postgres, backend -> mailhog, backend -> minio) is scoped
# to "traffic whose source is that other service's security group", never
# an open CIDR. All four allow all egress (docker/dnf pulls, Secrets
# Manager, S3 - none of those have a fixed, safely-allowlistable IP range).
#
# No inbound admin ports at all (no SSH, no admin-web CIDR rule) - every
# instance is reached exclusively through AWS Systems Manager Session
# Manager (`aws ssm start-session`, desktop-runner's Deploy tab has buttons
# for this). SSM's agent calls OUT to AWS from inside the instance, so
# there's nothing to open inbound for it - this used to be an
# `admin_cidr`-gated SSH+web-UI rule per instance, removed once we confirmed
# this account's LabRole already carries AmazonSSMManagedInstanceCore.
# `deploy-backend.sh` was rewritten the same way (S3-staged transfer + SSM
# Run Command) - it never actually had a real SSH key pair wired to these
# instances in the first place (no `key_name` was ever set), so this isn't
# a regression, it's finishing what was already half-built.

resource "aws_security_group" "backend" {
  name        = "${var.project_name}-backend"
  description = "NestJS backend instance - 3000 open to the internet (Android app). Admin access via SSM only, no inbound admin ports."
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "App API - must be reachable from any network (Android client)."
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
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
  description = "Postgres instance - 5432 only from the backend SG. Admin access via SSM only, no inbound admin ports."
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "Postgres - backend only."
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.backend.id]
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
  description = "MailHog instance (SES replacement) - SMTP 1025 only from the backend SG. Web UI + admin access via SSM port-forwarding only, no inbound admin ports."
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "SMTP - backend only."
    from_port       = 1025
    to_port         = 1025
    protocol        = "tcp"
    security_groups = [aws_security_group.backend.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-mailhog" }
}

# Conditionally created - only exists when var.use_minio is true (default
# false, real S3 preferred). Referenced with a splat/index elsewhere
# (ec2_minio.tf, ec2_backend.tf's user_data) guarded by the same condition.
resource "aws_security_group" "minio" {
  count       = var.use_minio ? 1 : 0
  name        = "${var.project_name}-minio"
  description = "MinIO instance (S3 replacement, opt-in) - API 9000 only from the backend SG. Console + admin access via SSM port-forwarding only, no inbound admin ports."
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "MinIO S3 API - backend only."
    from_port       = 9000
    to_port         = 9000
    protocol        = "tcp"
    security_groups = [aws_security_group.backend.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-minio" }
}
