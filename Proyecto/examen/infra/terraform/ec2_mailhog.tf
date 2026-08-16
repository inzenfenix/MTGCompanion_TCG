resource "aws_instance" "mailhog" {
  ami                    = data.aws_ami.amazon_linux.id
  instance_type          = var.instance_type_mailhog
  subnet_id              = local.subnet_id
  vpc_security_group_ids = [aws_security_group.mailhog.id]
  iam_instance_profile   = var.instance_profile_name

  # No EBS needed — mail sent through a demo/test SMTP relay is disposable.
  user_data = file("${path.module}/user_data/mailhog.sh.tpl")

  tags = { Name = "${var.project_name}-mailhog" }
}
