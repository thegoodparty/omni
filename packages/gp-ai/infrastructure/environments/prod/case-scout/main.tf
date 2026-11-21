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

  environment                      = "prod"
  shared_slack_notifier_lambda_arn = data.terraform_remote_state.shared_slack_notifier.outputs.lambda_function_arn
  failure_notification_email       = var.failure_notification_email

  # The prod Slack note goes to #product-chats-digest, a private channel, so
  # it is pinned by ID rather than looked up by name.
  slack_channel = "C0C626B0ZJN"

  # CASE_SCOUT_OPEN_PRS is deliberately unset, so publisher.py stays a dry
  # run: a week of notes on real chats before the first PR.
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
