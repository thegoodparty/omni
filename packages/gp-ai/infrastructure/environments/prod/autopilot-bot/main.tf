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
    key          = "autopilot-bot/prod/terraform.tfstate"
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

locals {
  environment = "prod"
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

# autopilot-agent-fargate's module has no subnet output, so this is sourced
# the same way clickup-bot's own prod root sources it: a pinned root
# variable, not remote state. Prod private subnets, matching every other
# prod gp-ai Fargate root (e.g. ../pmf-engine-control-plane/main.tf,
# ../clickup-bot/main.tf).
variable "private_subnet_ids" {
  description = "Private subnet IDs for the ECS tasks this Lambda launches"
  type        = list(string)
  default     = ["subnet-053357b931f0524d4", "subnet-0bb591861f72dcb7f"]
}

data "terraform_remote_state" "autopilot_agent_fargate" {
  backend = "s3"

  config = {
    bucket = "goodparty-terraform-state-us-west-2"
    key    = "autopilot-agent-fargate/prod/terraform.tfstate"
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

  environment = local.environment

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

  # SILENCED until prod rollout (ENG-11104 and its prod-side follow-up): no
  # ClickUp webhook points at this Lambda yet, so the no-deliveries alarm
  # would be permanently red from the moment this first applies. Flip to
  # true (or delete this line, the module default is true) once the prod
  # webhook is registered.
  no_deliveries_alarm_enabled = false
}

# ALB wiring lives HERE, not in shared-infra, on purpose. shared-infra's own
# target-group/listener-rule blocks for clickup-bot/ddhq-matcher/serve-analyze
# read those Lambdas' state via terraform_remote_state, which only works
# because those Lambdas' state already existed before shared-infra referenced
# it. autopilot-bot is new: its state does not exist until this root's first
# apply, so a shared-infra reference to it would hard-fail "Unable to find
# remote state" on every plan until this root applies FIRST — a chicken-and-
# egg shared-infra can't be the one to resolve. Looking the listener up live
# (not through shared-infra's state) sidesteps the ordering problem entirely:
# this root creates the Lambda AND its ALB attachment in one state, so the
# target group attachment can reference module.autopilot_bot's OWN outputs
# directly, with an ordinary in-graph dependency instead of a cross-state one.
data "aws_lb" "ai" {
  name = "ai-${local.environment}"
}

data "aws_lb_listener" "https" {
  load_balancer_arn = data.aws_lb.ai.arn
  port              = 443
}

resource "aws_lb_target_group" "autopilot_bot" {
  name        = "autopilot-bot-${local.environment}"
  target_type = "lambda"

  tags = {
    Name        = "autopilot-bot-${local.environment}"
    Environment = local.environment
    Purpose     = "Autopilot ClickUp Webhook Handler"
  }
}

resource "aws_lb_target_group_attachment" "autopilot_bot" {
  target_group_arn = aws_lb_target_group.autopilot_bot.arn
  target_id        = module.autopilot_bot.lambda_function_arn
  depends_on       = [aws_lambda_permission.autopilot_bot_alb_invoke]
}

resource "aws_lambda_permission" "autopilot_bot_alb_invoke" {
  statement_id  = "AllowExecutionFromALB"
  action        = "lambda:InvokeFunction"
  function_name = module.autopilot_bot.lambda_function_name
  principal     = "elasticloadbalancing.amazonaws.com"
  source_arn    = aws_lb_target_group.autopilot_bot.arn
}

# No x-api-key condition (unlike serve_analyze/ddhq_matcher): auth is the
# HMAC signature the Lambda itself verifies against the request body
# (AUTOPILOT_CLICKUP_WEBHOOK_SECRET), the same posture as clickup_bot's
# single, unconditional listener rule. Priority 30: shared-infra's own rules
# on this listener top out at 25 (dev) / 20 (prod) as of this writing.
resource "aws_lb_listener_rule" "autopilot_bot" {
  listener_arn = data.aws_lb_listener.https.arn
  priority     = 30

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.autopilot_bot.arn
  }

  condition {
    path_pattern {
      values = ["/autopilot/webhook"]
    }
  }

  tags = {
    Name        = "autopilot-bot-${local.environment}"
    Environment = local.environment
  }
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
