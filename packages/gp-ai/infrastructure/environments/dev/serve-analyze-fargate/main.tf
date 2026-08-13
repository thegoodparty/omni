terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket = "goodparty-terraform-state-us-west-2"
    key    = "serve-analyze-fargate/dev/terraform.tfstate"
    region = "us-west-2"

    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  region = "us-west-2"

  default_tags {
    tags = {
      Project = "serve-analyze"
    }
  }
}

variable "vpc_id" {
  description = "VPC ID for ECS deployment"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for ECS tasks"
  type        = list(string)
}

variable "failure_notification_email" {
  description = "Email for failure notifications (optional)"
  type        = string
  default     = ""
}

# Looked up live rather than read from terraform state. The ECR repo is the one
# resource here with no environment dimension, so it does not belong to any
# env's deploy and is managed outside Terraform. A remote_state read would break
# the moment that root is retired (the state file survives with no outputs), and
# it coupled six roots to a state file nothing writes.
variable "docker_image_tag" {
  description = "Immutable, SHA-pinned image tag (e.g. broker-a1b2c3d4). CI passes this per deploy; there is no default so a missing value fails loudly instead of silently shipping a mutable tag."
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

module "serve_analyze_fargate" {
  source = "../../../modules/serve-analyze-fargate"

  environment                        = "dev"
  vpc_id                             = var.vpc_id
  private_subnet_ids                 = var.private_subnet_ids
  ecr_repository_url                 = data.aws_ecr_repository.ai_projects.repository_url
  docker_image_tag                   = var.docker_image_tag
  sqs_queue_arn                      = "arn:aws:sqs:us-west-2:333022194791:develop-Queue.fifo"
  sqs_queue_url                      = "https://sqs.us-west-2.amazonaws.com/333022194791/develop-Queue.fifo"
  shared_slack_notifier_lambda_arn   = data.terraform_remote_state.shared_slack_notifier.outputs.lambda_function_arn
  failure_notification_email         = var.failure_notification_email
}

output "cluster_name" {
  value       = module.serve_analyze_fargate.cluster_name
  description = "ECS cluster name"
}

output "lambda_function_arn" {
  value       = module.serve_analyze_fargate.lambda_function_arn
  description = "Lambda trigger function ARN"
}

output "lambda_function_name" {
  value       = module.serve_analyze_fargate.lambda_function_name
  description = "Lambda trigger function name"
}

output "s3_bucket_name" {
  value       = module.serve_analyze_fargate.s3_bucket_name
  description = "S3 bucket for pipeline data"
}

output "ecr_repository_url" {
  value       = data.aws_ecr_repository.ai_projects.repository_url
  description = "ECR repository URL for Docker images"
}
