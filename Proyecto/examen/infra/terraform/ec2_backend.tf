# The NestJS app instance. No EBS (stateless — Postgres/S3-or-MinIO hold all
# persistent data). user_data only installs Docker; the actual app image +
# .env are delivered afterwards by scripts/deploy-backend.sh over SSH (see
# that script's own header for why this isn't baked into user_data).
resource "aws_instance" "backend" {
  ami                    = data.aws_ami.amazon_linux.id
  instance_type          = var.instance_type_backend
  subnet_id              = local.subnet_id
  vpc_security_group_ids = [aws_security_group.backend.id]
  iam_instance_profile   = var.instance_profile_name

  user_data = file("${path.module}/user_data/backend.sh.tpl")

  tags = { Name = "${var.project_name}-backend" }
}
