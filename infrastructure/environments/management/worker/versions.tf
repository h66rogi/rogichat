terraform {
  required_version = "= 1.16.3"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 6.65.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "= 2.8.1"
    }
  }
  backend "s3" {}
}

provider "aws" {
  region = "ap-northeast-2"
  default_tags {
    tags = {
      Project     = "rogichat"
      Environment = "management"
      Component   = "worker-canary"
      ManagedBy   = "terraform"
    }
  }
}
