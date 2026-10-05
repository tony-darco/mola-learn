terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.80" }
  }

  # Bucket comes from `bootstrap/`; pass it at init time:
  #   terraform init -backend-config="bucket=mola-tfstate-<account-id>"
  backend "s3" {
    key          = "mola/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project     = "mola"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
