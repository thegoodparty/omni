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
    key          = "case-scout/dev/terraform.tfstate"
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

variable "failure_notification_email" {
  description = "Email for failure notifications (optional)"
  type        = string
  default     = ""
}

data "terraform_remote_state" "shared_slack_notifier" {
  backend = "s3"

  config = {
    bucket = "goodparty-terraform-state-us-west-2"
    key    = "shared/slack-notifier/terraform.tfstate"
    region = "us-west-2"
  }
}

module "case_scout" {
  source = "../../../modules/case-scout"

  environment                      = "dev"
  shared_slack_notifier_lambda_arn = data.terraform_remote_state.shared_slack_notifier.outputs.lambda_function_arn
  failure_notification_email       = var.failure_notification_email

  # slack_channel is left at the module's own default (empty):
  # publisher.py's slack_channel_for_environment() already resolves the dev
  # channel when CASE_SCOUT_SLACK_CHANNEL is unset. Setting it here would
  # duplicate that default in a second place that can drift from the code.
}

output "lambda_function_name" {
  value       = module.case_scout.lambda_function_name
  description = "Lambda function name (the Publisher)"
}

output "lambda_function_arn" {
  value       = module.case_scout.lambda_function_arn
  description = "Lambda function ARN"
}

output "bucket_name" {
  value       = module.case_scout.bucket_name
  description = "S3 bucket holding the scout's bundles/ledger/marker"
}
