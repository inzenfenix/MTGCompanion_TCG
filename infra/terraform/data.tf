# AWS Academy Lab accounts typically can't create VPCs but always have a
# default one — use it rather than a new aws_vpc resource.
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# Pick one subnet deterministically (first by id) — every instance in this
# stack lives in the same subnet, they only need to reach each other over
# the default VPC's local routing plus the internet gateway the default VPC
# already has.
locals {
  subnet_id = sort(data.aws_subnets.default.ids)[0]
}

# Latest Amazon Linux 2023 AMI — avoids a hardcoded, region/staleness-prone
# AMI id.
data "aws_ami" "amazon_linux" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}
