terraform {
  required_version = "= 1.16.3"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 6.65.0"
    }
  }
  backend "s3" {}
}

provider "aws" {
  region              = "ap-northeast-2"
  allowed_account_ids = [var.aws_account_id]
  default_tags {
    tags = {
      Project     = "rogichat"
      Environment = "prod"
      ManagedBy   = "terraform"
    }
  }
}
