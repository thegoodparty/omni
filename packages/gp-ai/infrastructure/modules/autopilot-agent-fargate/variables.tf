variable "environment" {
  description = "Environment name (dev, prod)"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID for ECS tasks"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for ECS tasks"
  type        = list(string)
}

variable "ecr_repository_url" {
  description = "ECR repository URL for gp-ai-projects Docker images"
  type        = string
}

variable "docker_image_tag" {
  description = "Immutable, SHA-pinned image tag for the base autopilot-agent image (e.g. autopilot-agent-a1b2c3d), used by the epic-create/story/resume stages. No default on purpose: CI always passes it, and a default silently ships the wrong image."
  type        = string
}

variable "docker_image_tag_playwright" {
  description = "Immutable, SHA-pinned image tag for the Playwright-installed autopilot-agent-playwright image (e.g. autopilot-agent-playwright-a1b2c3d), used by the qa stage only. Same no-default reasoning as docker_image_tag."
  type        = string
}

variable "failure_notification_email" {
  description = "Email address to receive ECS task failure notifications"
  type        = string
  default     = ""
}

variable "shared_slack_notifier_lambda_arn" {
  description = "ARN of the shared Slack notifier Lambda function"
  type        = string
  default     = ""
}

variable "task_cpu" {
  description = "CPU units for ECS Fargate tasks. Shared by both variants — only memory scales for the Playwright/qa task."
  type        = string
  default     = "2048"
}

variable "task_memory" {
  description = "Memory for the base autopilot-agent task (epic-create/story/resume), in MB"
  type        = string
  default     = "4096"
}

variable "task_memory_playwright" {
  description = "Memory for the autopilot-agent-playwright (qa) task, in MB. 2x the base task: a headless Chromium under Playwright needs meaningfully more headroom than the base agent."
  type        = string
  default     = "8192"
}
