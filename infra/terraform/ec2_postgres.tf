resource "aws_instance" "postgres" {
  ami                    = data.aws_ami.amazon_linux.id
  instance_type          = var.instance_type_postgres
  subnet_id              = local.subnet_id
  vpc_security_group_ids = [aws_security_group.postgres.id]
  iam_instance_profile   = var.instance_profile_name

  user_data = templatefile("${path.module}/user_data/postgres.sh.tpl", {
    device_name                  = "/dev/sdf"
    aws_region                   = var.aws_region
    postgres_password_secret_arn = aws_secretsmanager_secret.postgres_password.arn
  })

  tags = { Name = "${var.project_name}-postgres" }
}

# Separate from the instance so `terraform apply` replacing the instance
# (AMI update, instance-type change) doesn't touch the data volume — same
# reasoning as ROADMAP.md workstream I's own note on this.
resource "aws_ebs_volume" "postgres_data" {
  availability_zone = aws_instance.postgres.availability_zone
  size              = 20
  type              = "gp3"

  tags = { Name = "${var.project_name}-postgres-data" }
}

resource "aws_volume_attachment" "postgres_data" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.postgres_data.id
  instance_id = aws_instance.postgres.id
}
