# Elastic IP for the backend instance — without this, `backend`'s public IP
# is the default ephemeral one, which changes on every stop/start. AWS
# Academy Lab sessions routinely stop instances between sessions (confirmed
# 16 ago: IP moved from 98.92.218.66 to 100.61.127.188 with no `apply` run
# in between), which silently breaks the APK's baked-in VITE_API_BASE_URL
# and the Android cleartext-exception host. An EIP survives stop/start —
# only a `terraform destroy`/instance replacement changes it. Free while
# associated with a *running* instance; AWS charges a small hourly fee if
# the instance is stopped or the address is left unassociated — an accepted
# trade-off for a course project (see README.md).
resource "aws_eip" "backend" {
  domain = "vpc"
  tags   = { Name = "${var.project_name}-backend-eip" }
}

resource "aws_eip_association" "backend" {
  instance_id   = aws_instance.backend.id
  allocation_id = aws_eip.backend.id
}
