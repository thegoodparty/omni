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
    key          = "alert-filter/prod/terraform.tfstate"
    region       = "us-west-2"
    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  region = "us-west-2"

  default_tags {
    tags = {
      Project = "alert-filter"
    }
  }
}

# ONE FUNCTION SERVES BOTH ENVIRONMENTS' ALERTS, which is why there is no
# environments/dev/alert-filter beside this.
#
# Grafana provisions the same rules for dev and prod, and a notification carries
# its own `environment` label — which the handler reads, and which the registry's
# evidence queries were resolved against at provision time. So the filter does
# not need to run twice; it needs to know which environment notified it, and it
# does. A second copy would double the infrastructure to halve nothing.
#
# The value pinned below follows from that: this is the prod stack because that
# is where a public endpoint with an uptime expectation belongs, and dev alerts
# are simply a second caller of it.

# THE DEFAULT IS THE PROD VALUE, deliberately, for the reason written at length
# in ../clickup-bot/main.tf: that module's real value once lived only in a
# gitignored tfvars, and an apply from a checkout without it silently disabled
# the bot for 12 days. The same shape of mistake here would silently flip the
# filter between shadow and enforce — one direction makes it useless, the other
# starts hiding alerts nobody reviewed.
variable "mode" {
  description = "shadow (record decisions only) or enforce (apply them). See the module."
  type        = string
  default     = "shadow"
}

# #dev-alerts-raw. Everything lands here, including suppressions, each with a
# threaded reply saying what the filter decided.
#
# EVERY ID IN THIS FILE WAS READ BACK FROM THE WORKSPACE, not copied from a
# design doc, and this one matters most. A plausible-looking wrong channel ID is
# the worst failure this system has: Slack answers `channel_not_found`, the raw
# post never lands, and the invariant that every delivered alert reaches a human
# is gone — quietly, while the filtered channel keeps working and the whole
# thing looks healthy. Suppression is only defensible because this channel
# exists, so if you change this value, verify the new one against Slack first.
#
# (The first draft of this file had a wrong ID for #dev-alerts, from exactly
# that copied-from-a-doc path. It was caught by checking; it would not have been
# caught by reading.)
variable "raw_channel_id" {
  description = "Slack channel ID for the unfiltered feed (#dev-alerts-raw)"
  type        = string
  default     = "C0C1PDD4RGD"
}

# #dev-alerts, the channel this whole exercise is about. Verified against the
# workspace rather than copied from a doc.
variable "filtered_channel_id" {
  description = "Slack channel ID for the filtered feed"
  type        = string
  default     = "C0AHXARLX2T"
}

# #bot-urgent.
variable "urgent_channel_id" {
  description = "Slack channel ID that mirrors urgent alerts"
  type        = string
  default     = "C0C1JSUPPEX"
}

variable "slack_workspace_domain" {
  description = "Workspace subdomain, for building permalinks back to the raw post"
  type        = string
  default     = "goodparty"
}

# Grafana Cloud's Loki endpoint for this stack. Non-secret; the token that goes
# with it comes from AI_SECRETS_PROD.
variable "loki_url" {
  description = "Grafana Cloud Loki base URL"
  type        = string
  default     = ""
}

variable "loki_user" {
  description = "Grafana Cloud Loki stack user (numeric)"
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

module "alert_filter" {
  source = "../../../modules/alert-filter"

  environment = "prod"
  mode        = var.mode

  raw_channel_id         = var.raw_channel_id
  filtered_channel_id    = var.filtered_channel_id
  urgent_channel_id      = var.urgent_channel_id
  slack_workspace_domain = var.slack_workspace_domain

  loki_url  = var.loki_url
  loki_user = var.loki_user

  shared_slack_notifier_lambda_arn = data.terraform_remote_state.shared_slack_notifier.outputs.lambda_function_arn
}

output "failure_sns_topic_arn" {
  value       = module.alert_filter.failure_sns_topic_arn
  description = "SNS topic that receives alert-filter error alarms"
}

output "lambda_function_arn" {
  value       = module.alert_filter.lambda_function_arn
  description = "Lambda function ARN"
}

output "lambda_function_name" {
  value       = module.alert_filter.lambda_function_name
  description = "Lambda function name"
}

output "mode" {
  value       = module.alert_filter.mode
  description = "Whether the filter is enforcing its decisions or only recording them"
}
