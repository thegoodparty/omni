variable "environment" {
  description = "Environment name (dev, prod)"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID for the Reader's ECS tasks"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for the Reader's ECS tasks"
  type        = list(string)
}

variable "ecr_repository_url" {
  description = "ECR repository URL for gp-ai-projects Docker images"
  type        = string
}

variable "docker_image_tag" {
  description = "Immutable, SHA-pinned Reader image tag (e.g. case-scout-a1b2c3d). No default on purpose — see autopilot-agent-fargate's identical variable: a default silently ships the wrong image."
  type        = string
}

variable "task_cpu" {
  description = "CPU units for the Reader's ECS Fargate task"
  type        = string
  default     = "1024"
}

variable "task_memory" {
  description = "Memory for the Reader's ECS Fargate task, in MB"
  type        = string
  default     = "2048"
}

variable "github_app_id" {
  description = "GitHub App id (not a secret) the Publisher mints installation tokens as — the Delegate App, same identity autopilot/lambda/github_auth.py uses (the app already has permission to open PRs on omni; TDD section 9)."
  type        = string
  default     = "3107048"
}

variable "github_app_installation_id" {
  description = "The Delegate App's installation id on thegoodparty (not a secret)."
  type        = string
  default     = "117364330"
}

variable "shared_slack_notifier_lambda_arn" {
  description = "ARN of the shared Slack notifier Lambda to subscribe to failure notifications (empty disables)"
  type        = string
  default     = ""
}

variable "failure_notification_email" {
  description = "Email address for failure notifications (empty disables)"
  type        = string
  default     = ""
}
