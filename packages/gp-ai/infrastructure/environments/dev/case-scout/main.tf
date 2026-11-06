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

variable "vpc_id" {
  description = "VPC ID for the Reader's ECS tasks"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for the Reader's ECS tasks"
  type        = list(string)
}

variable "failure_notification_email" {
  description = "Email for failure notifications (optional)"
  type        = string
  default     = ""
}

# Looked up live rather than read from terraform state — see
# autopilot-agent-fargate/dev's identical comment: the ECR repo has no
# environment dimension and is managed outside Terraform.
variable "docker_image_tag" {
  description = "Immutable, SHA-pinned Reader image tag (e.g. case-scout-a1b2c3d4). CI passes this per deploy; there is no default so a missing value fails loudly instead of silently shipping a mutable tag."
  type        = string
}

data "aws_ecr_repository" "ai_projects" {
  name = "gp-ai-projects"
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
  vpc_id                           = var.vpc_id
  private_subnet_ids               = var.private_subnet_ids
  ecr_repository_url               = data.aws_ecr_repository.ai_projects.repository_url
  docker_image_tag                 = var.docker_image_tag
  shared_slack_notifier_lambda_arn = data.terraform_remote_state.shared_slack_notifier.outputs.lambda_function_arn
  failure_notification_email       = var.failure_notification_email

  # slack_channel and spend_cap_usd are left at the module's own defaults
  # (empty): publisher.py's slack_channel_for_environment() and
  # reader/spend.py's own conservative cap already resolve the right dev
  # values (CL23R5BJ4, the placeholder cap) when CASE_SCOUT_SLACK_CHANNEL /
  # CASE_SCOUT_SPEND_CAP_USD are unset. Setting them here would duplicate
  # those defaults in a second place that can drift from the code.
}

output "reader_cluster_arn" {
  value       = module.case_scout.reader_cluster_arn
  description = "ECS cluster ARN for the Reader's Fargate task"
}

output "lambda_function_name" {
  value       = module.case_scout.lambda_function_name
  description = "Lambda function name (start/publish entry points)"
}

output "lambda_function_arn" {
  value       = module.case_scout.lambda_function_arn
  description = "Lambda function ARN"
}

output "bucket_name" {
  value       = module.case_scout.bucket_name
  description = "S3 bucket holding the scout's bundles/ledger/marker"
}
