# No access_key/secret_key/token args below — the AWS provider falls back to
# its default credential chain, i.e. the ambient AWS_ACCESS_KEY_ID/
# AWS_SECRET_ACCESS_KEY/AWS_SESSION_TOKEN env vars. That's a deliberate
# change (19 ago, ROADMAP.md M-adjacent bugfix): this used to read
# var.aws_access_key_id etc. instead, fed by TF_VAR_* env vars from
# desktop-runner's Deploy tab — but Terraform's *.tfvars files silently
# outrank TF_VAR_* env-var injection, and this project's own
# terraform.tfvars.example told people to hand-edit terraform.tfvars with
# credentials directly (needed before the Deploy tab existed). A stale
# hand-edited credential set in that file would then shadow whatever fresh
# credentials got pasted into the Deploy tab afterward, surfacing as a
# confusing ExpiredToken/AccessDenied that looked AWS-side — already found
# and documented once (16 ago, this file's own git history / README.md) as
# a "keep it in sync by hand" footgun, then actually hit in practice by the
# user (19 ago) despite having just repasted fresh credentials. Removing
# these 3 args (and their variables, see variables.tf) removes the
# possibility of the file shadowing anything: there is no
# var.aws_access_key_id left for a stale terraform.tfvars line to override,
# so the *only* source of truth left is whatever env vars the process was
# spawned with — same AWS_* names buildAwsCliEnv() already sets for every
# other AWS-touching command in this project (S3 sync, SSM), now also used
# for `terraform` itself (see runTerraform() in scripts.service.ts).
terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}
