terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket       = "goodparty-terraform-state-us-west-2"
    key          = "engineer-agent-fargate/prod/terraform.tfstate"
    region       = "us-west-2"
    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  region = "us-west-2"

  default_tags {
    tags = {
      Project = "engineer-agent"
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

# pinned in git because the gitignored tfvars pattern silently dropped alerting on clean-checkout applies
variable "failure_notification_email" {
  description = "Email for failure notifications (optional)"
  type        = string
  default     = "collin@goodparty.org"
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

module "engineer_agent_fargate" {
  source = "../../../modules/engineer-agent-fargate"

  environment                      = "prod"
  vpc_id                           = var.vpc_id
  private_subnet_ids               = var.private_subnet_ids
  ecr_repository_url               = data.aws_ecr_repository.ai_projects.repository_url
  docker_image_tag                 = var.docker_image_tag
  shared_slack_notifier_lambda_arn = data.terraform_remote_state.shared_slack_notifier.outputs.lambda_function_arn
  failure_notification_email       = var.failure_notification_email

  # Passed explicitly even though the module already defaults to false, for the
  # same reason failure_notification_email is pinned above: this is the switch
  # that decides whether the bot can open PRs unprompted, and an operator asking
  # "is that on in prod?" should find the answer here rather than by inferring a
  # module default.
  #
  # ON since 2026-08-17. The two preconditions it was waiting on are met:
  # vars.GPBOT_PR_CHANNEL_ID points at #bugs and the triage workflow carries an
  # app that can actually post there. To turn the bot off, set this to false and
  # apply — that is the kill switch, and it is faster than reverting code because
  # it does not wait on a release train.
  escalate_analysis_to_work = true
}

output "cluster_name" {
  value       = module.engineer_agent_fargate.cluster_name
  description = "ECS cluster name"
}

output "cluster_arn" {
  value       = module.engineer_agent_fargate.cluster_arn
  description = "ECS cluster ARN"
}

output "task_definition_arn" {
  value       = module.engineer_agent_fargate.task_definition_arn
  description = "ECS task definition ARN"
}

output "task_definition_family" {
  value       = module.engineer_agent_fargate.task_definition_family
  description = "ECS task definition family"
}

output "security_group_id" {
  value       = module.engineer_agent_fargate.security_group_id
  description = "Security group ID for ECS tasks"
}

output "task_execution_role_arn" {
  value       = module.engineer_agent_fargate.task_execution_role_arn
  description = "Task execution role ARN"
}

output "task_role_arn" {
  value       = module.engineer_agent_fargate.task_role_arn
  description = "Task role ARN"
}

output "ecr_repository_url" {
  value       = data.aws_ecr_repository.ai_projects.repository_url
  description = "ECR repository URL for Docker images"
}
