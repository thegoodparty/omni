terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  backend "s3" {
    bucket       = "goodparty-terraform-state-us-west-2"
    key          = "case-scout/prod/terraform.tfstate"
    region       = "us-west-2"
    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  region = "us-west-2"

  default_tags {
    tags = {
      Project = "case-scout"
    }
  }
}

module "case_scout" {
  source = "../../../modules/case-scout"

  environment = "prod"
}

output "bucket_name" {
  value       = module.case_scout.bucket_name
  description = "S3 bucket the scout's gp-api jobs read and write"
}
