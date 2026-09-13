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
    key          = "autopilot-bot/dev/terraform.tfstate"
    region       = "us-west-2"
    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  region = "us-west-2"

  default_tags {
    tags = {
      Project = "autopilot-bot"
    }
  }
}

variable "autopilot_list_ids" {
  description = "AUTOPILOT_LIST_IDS: comma-separated ClickUp list IDs in scope. Placeholder until task 14 supplies the real board IDs."
  type        = string
  default     = ""
}

variable "autopilot_story_list_ids" {
  description = "AUTOPILOT_STORY_LIST_IDS. Placeholder until task 14 supplies the real board IDs."
  type        = string
  default     = ""
}

variable "autopilot_bot_user_id" {
  description = "AUTOPILOT_BOT_USER_ID. Placeholder until task 14 supplies it."
  type        = string
  default     = ""
}

variable "autopilot_slack_channel" {
  description = "AUTOPILOT_SLACK_CHANNEL for supervisor stall/close-out alerts (not a secret)."
  type        = string
  default     = ""
}

# autopilot-agent-fargate's module has no subnet output (only security_group_id,
# task roles, cluster/task-def identifiers), so this is sourced the same way
# clickup-bot's own root sources it: a pinned root variable, not remote state.
# Same non-secret dev subnets every other dev gp-ai Fargate root uses.
variable "private_subnet_ids" {
  description = "Private subnet IDs for the ECS tasks this Lambda launches"
  type        = list(string)
  default     = ["subnet-053357b931f0524d4", "subnet-0bb591861f72dcb7f"]
}

data "terraform_remote_state" "autopilot_agent_fargate" {
  backend = "s3"

  config = {
    bucket = "goodparty-terraform-state-us-west-2"
    key    = "autopilot-agent-fargate/dev/terraform.tfstate"
    region = "us-west-2"
  }
}

# Routes the module's handler-error alarm to Slack (same notifier every other
# gp-ai bot's failure topic uses).
data "terraform_remote_state" "shared_slack_notifier" {
  backend = "s3"

  config = {
    bucket = "goodparty-terraform-state-us-west-2"
    key    = "shared/slack-notifier/terraform.tfstate"
    region = "us-west-2"
  }
}

module "autopilot_bot" {
  source = "../../../modules/autopilot-bot"

  environment = "dev"

  ecs_cluster_arn                       = data.terraform_remote_state.autopilot_agent_fargate.outputs.cluster_arn
  ecs_task_definition_family            = data.terraform_remote_state.autopilot_agent_fargate.outputs.task_definition_family
  ecs_task_definition_family_playwright = data.terraform_remote_state.autopilot_agent_fargate.outputs.task_definition_family_playwright
  ecs_subnet_ids                        = var.private_subnet_ids
  ecs_security_group_id                 = data.terraform_remote_state.autopilot_agent_fargate.outputs.security_group_id
  ecs_task_execution_role_arn           = data.terraform_remote_state.autopilot_agent_fargate.outputs.task_execution_role_arn
  ecs_task_role_arn                     = data.terraform_remote_state.autopilot_agent_fargate.outputs.task_role_arn

  autopilot_list_ids       = var.autopilot_list_ids
  autopilot_story_list_ids = var.autopilot_story_list_ids
  autopilot_bot_user_id    = var.autopilot_bot_user_id
  autopilot_slack_channel  = var.autopilot_slack_channel

  shared_slack_notifier_lambda_arn = data.terraform_remote_state.shared_slack_notifier.outputs.lambda_function_arn

  # Dev is expected to get its ClickUp webhook registered soon after this
  # lands (ENG-11104), so leave the no-deliveries alarm armed (module default).
}

output "lambda_function_arn" {
  value       = module.autopilot_bot.lambda_function_arn
  description = "Lambda function ARN"
}

output "lambda_function_name" {
  value       = module.autopilot_bot.lambda_function_name
  description = "Lambda function name"
}

output "failure_sns_topic_arn" {
  value       = module.autopilot_bot.failure_sns_topic_arn
  description = "SNS topic that receives autopilot-bot handler error alarms"
}
