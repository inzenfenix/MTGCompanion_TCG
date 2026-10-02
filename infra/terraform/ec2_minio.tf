# Opt-in — only created when use_minio=true (default false, real S3
# preferred, see s3.tf). Mirrors ec2_postgres.tf's shape (own EBS volume for
# /data, secrets pulled from Secrets Manager at boot via the instance role).

resource "aws_instance" "minio" {
  count                  = var.use_minio ? 1 : 0
  ami                    = data.aws_ami.amazon_linux.id
  instance_type          = var.instance_type_minio
  subnet_id              = local.subnet_id
  vpc_security_group_ids = [aws_security_group.minio[0].id]
  iam_instance_profile   = var.instance_profile_name

  user_data = templatefile("${path.module}/user_data/minio.sh.tpl", {
    device_name                    = "/dev/sdf"
    aws_region                     = var.aws_region
    minio_root_user_secret_arn     = aws_secretsmanager_secret.minio_root_user[0].arn
    minio_root_password_secret_arn = aws_secretsmanager_secret.minio_root_password[0].arn
  })

  tags = { Name = "${var.project_name}-minio" }
}

resource "aws_ebs_volume" "minio_data" {
  count             = var.use_minio ? 1 : 0
  availability_zone = aws_instance.minio[0].availability_zone
  size              = 30
  type              = "gp3"

  tags = { Name = "${var.project_name}-minio-data" }
}

resource "aws_volume_attachment" "minio_data" {
  count       = var.use_minio ? 1 : 0
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.minio_data[0].id
  instance_id = aws_instance.minio[0].id
}
