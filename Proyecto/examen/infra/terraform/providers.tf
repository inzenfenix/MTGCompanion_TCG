# Reads credentials straight from Terraform variables (see variables.tf),
# not the ambient shell env / a CLI profile / a config file — this is the
# "rotate temporary Academy Lab creds by editing one file" requirement from
# ROADMAP.md workstream I: `terraform.tfvars` is the one thing to update
# every ~4h, no shell state to remember or re-export.
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
  region     = var.aws_region
  access_key = var.aws_access_key_id
  secret_key = var.aws_secret_access_key
  token      = var.aws_session_token
}
