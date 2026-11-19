variable "environment" {
  description = "Environment name (dev, prod)"
  type        = string
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

variable "slack_channel" {
  description = "CASE_SCOUT_SLACK_CHANNEL override for the Lambda (empty uses publisher.py's own per-environment default)."
  type        = string
  default     = ""
}
