terraform {
  required_version = "= 1.16.3"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "= 5.25.0"
    }
  }
  backend "s3" {}
}

# Authentication comes from CLOUDFLARE_API_TOKEN in the external executor environment.
provider "cloudflare" {}
