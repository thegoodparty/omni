variable "environment" {
  description = "Environment name (dev, prod)"
  type        = string
}

variable "ecs_cluster_arn" {
  description = "ARN of the autopilot-agent ECS cluster (autopilot-agent-fargate module output)"
  type        = string
}

variable "ecs_task_definition_family" {
  description = "Family of the base autopilot-agent ECS task definition, used for every stage except qa (epic-create/story/resume). This is what ECS_TASK_DEFINITION is set to."
  type        = string
}

variable "ecs_task_definition_family_playwright" {
  description = <<-EOT
    Family of the Playwright-installed autopilot-agent task definition
    (autopilot-agent-fargate module output). Set as ECS_TASK_DEFINITION_PLAYWRIGHT —
    dispatch.py's launch_fargate_stage picks this family when the stage is
    qa (Playwright E2E; the base image has no browsers) and ECS_TASK_DEFINITION
    otherwise. Also granted in the RunTask IAM policy alongside the base family.
  EOT
  type        = string
}

variable "ecs_subnet_ids" {
  description = "Subnet IDs for autopilot-agent ECS tasks (SUBNET_IDS)"
  type        = list(string)
}

variable "ecs_security_group_id" {
  description = "Security group ID for autopilot-agent ECS tasks (SECURITY_GROUP_ID)"
  type        = string
}

variable "ecs_task_execution_role_arn" {
  description = "autopilot-agent task execution role ARN (iam:PassRole target)"
  type        = string
}

variable "ecs_task_role_arn" {
  description = "autopilot-agent task role ARN (iam:PassRole target)"
  type        = string
}

# --- Routing/dispatch config. These default to "" so a clean apply ships a
# Lambda that fails closed (every event 200-skips as "list not in scope", or
# the gate refuses dispatch) rather than one that guesses at scope. Real
# values are wired per environment in that root's terraform.auto.tfvars — see
# environments/dev/autopilot-bot/terraform.auto.tfvars (ENG-11104) and that
# root's README.md for the board record. Prod stays on this placeholder until
# prod rollout.
variable "autopilot_list_ids" {
  description = "AUTOPILOT_LIST_IDS: comma-separated ClickUp list IDs in scope. Module default is a placeholder (\"\") so an environment root that hasn't wired the real board IDs still ships a Lambda where every webhook event is a no-op, never a misroute."
  type        = string
  default     = ""
}

variable "autopilot_bot_user_id" {
  description = "AUTOPILOT_BOT_USER_ID: ClickUp user id the human-actor gate treats as the bot's own writes. Module default is a placeholder (\"\") — router.py fails closed (refuses gate dispatch) rather than silently disabling the gate when unset."
  type        = string
  default     = ""
}

variable "autopilot_slack_channel" {
  description = "AUTOPILOT_SLACK_CHANNEL: Slack channel id the supervisor posts stall/close-out messages to. Not a secret (a channel id, not a credential) — a plain root variable rather than an AI_SECRETS entry. Unset drops the message with a log line (see supervisor.py's post_slack_message), never a hard failure."
  type        = string
  default     = ""
}

variable "sweep_lookback_minutes" {
  description = "SWEEP_LOOKBACK_MINUTES, passed through to the GitHub Actions sweep invocation's Lambda env. Matches sweep.py's own DEFAULT_LOOKBACK_MINUTES."
  type        = string
  default     = "45"
}

variable "sweep_max_triggers" {
  description = "SWEEP_MAX_TRIGGERS. Matches sweep.py's own DEFAULT_MAX_TRIGGERS."
  type        = string
  default     = "10"
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

# Toggle for the no-deliveries alarm's actions only (never the handler-errors
# alarm — a logged handler error is a real bug regardless of rollout stage).
# The no-deliveries alarm treats missing data as breaching (see below), so it
# is RED from the moment this Lambda first deploys until a real ClickUp
# webhook is registered against it — which is a separate, later step (webhook
# registration + live checks are ENG-11104). Default true (armed): dev is
# expected to get its webhook registered soon after this lands. The prod root
# passes false explicitly until prod rollout, so CI's SNS/Slack channel does
# not carry a permanently-red alarm for a bot that isn't live yet.
variable "no_deliveries_alarm_enabled" {
  description = "Whether the no-deliveries alarm's actions (SNS -> Slack/email) are armed. The alarm itself is always created; this only controls whether it notifies."
  type        = bool
  default     = true
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

# Lambda env vars sourced from Secrets Manager. Unlike clickup-bot, this
# Lambda's code never calls secretsmanager at runtime by design (see
# handler.py's and supervisor.py's module docstrings — "no secrets-outage
# degrade mode to reproduce"), so there is no equivalent of ECS task
# definitions' `secrets` block with `valueFrom` for Lambda to resolve at
# container start. Terraform is the only thing that can source these values
# from Secrets Manager; the values still never appear in git (only in this
# state file and the Lambda's env, same posture as shared-infra's
# local.api_key). The Lambda's own execution role therefore does NOT get a
# secretsmanager:GetSecretValue grant — it would be an unused permission, since
# nothing in autopilot/lambda/ ever calls that API.
data "aws_secretsmanager_secret_version" "ai_secrets" {
  secret_id = "AI_SECRETS_${upper(var.environment)}"
}

locals {
  ai_secrets = jsondecode(data.aws_secretsmanager_secret_version.ai_secrets.secret_string)
}

resource "aws_cloudwatch_log_group" "autopilot_bot" {
  name = "/aws/lambda/autopilot-bot-${var.environment}"
  # Matches clickup-bot's retention for the same reason: this is the only
  # durable record of what the webhook actually delivered.
  retention_in_days = 400

  tags = {
    Environment = var.environment
    Service     = "autopilot-bot"
  }
}

resource "aws_iam_role" "autopilot_bot" {
  name = "autopilot-bot-lambda-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Environment = var.environment
    Service     = "autopilot-bot"
  }
}

resource "aws_iam_role_policy_attachment" "autopilot_bot_basic" {
  role       = aws_iam_role.autopilot_bot.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Atomic dedup / claim table. dispatch.claim_transition does a conditional
# PutItem keyed "{task_id}#{stage}#{transitioned_at}"; supervisor.py reuses
# the SAME table under a separate key family ("epic#{epic_task_id}" for the
# in-flight claim, "epic-closed#{epic_task_id}" for the one-time close-out)
# with GetItem/PutItem/DeleteItem. expires_at (epoch seconds) is written by
# both claim paths and lets DynamoDB TTL garbage-collect old items.
# PAY_PER_REQUEST: traffic is a handful of writes per routed ClickUp event.
resource "aws_dynamodb_table" "dedup" {
  name         = "autopilot-dedup-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  attribute {
    name = "pk"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  tags = {
    Environment = var.environment
    Service     = "autopilot-bot"
  }
}

resource "aws_iam_role_policy" "autopilot_bot_dedup" {
  name = "dedup-table-access"
  role = aws_iam_role.autopilot_bot.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:DeleteItem"
        ]
        Resource = aws_dynamodb_table.dedup.arn
      }
    ]
  })
}

# RunTask against the autopilot-agent task family (both revisions — see
# ecs_task_definition_family_playwright's description for why the playwright
# family is granted even though nothing dispatches to it yet), scoped to the
# autopilot-agent cluster this Lambda is meant to launch into — never
# engineer-agent's cluster or task family, which is a separate bot with its
# own IAM. ecs:TagResource is required alongside RunTask because
# launch_fargate_stage's run_task call passes `tags=[...]` (tagging at
# creation needs its own grant, mirroring clickup-bot's identical policy).
resource "aws_iam_role_policy" "autopilot_bot_ecs" {
  name = "ecs-run-task"
  role = aws_iam_role.autopilot_bot.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecs:RunTask"
        ]
        Resource = [
          "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:task-definition/${var.ecs_task_definition_family}:*",
          "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:task-definition/${var.ecs_task_definition_family_playwright}:*"
        ]
        Condition = {
          ArnEquals = {
            "ecs:cluster" = var.ecs_cluster_arn
          }
        }
      },
      {
        Effect = "Allow"
        Action = [
          "ecs:TagResource"
        ]
        Resource = [
          "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:task/${element(split("/", var.ecs_cluster_arn), 1)}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "iam:PassRole"
        ]
        Resource = [
          var.ecs_task_execution_role_arn,
          var.ecs_task_role_arn
        ]
      }
    ]
  })
}

# Self-invoke for the fast-ack flow (see handler.py's module docstring): the
# webhook-facing call answers ClickUp in milliseconds and re-invokes this same
# function asynchronously to do the ClickUp/ECS work off the critical path.
# Constructed from the data sources, not aws_lambda_function.autopilot_bot.arn
# — the function depends on this role, so a role policy referencing the
# function would be a dependency cycle.
resource "aws_iam_role_policy" "autopilot_bot_self_invoke" {
  name = "self-invoke"
  role = aws_iam_role.autopilot_bot.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "lambda:InvokeFunction"
        ]
        Resource = "arn:aws:lambda:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:function:autopilot-bot-${var.environment}"
      }
    ]
  })
}

# Terraform owns the zip, same as clickup-bot post-2026-08-10 (see that
# module's comment for the history). No dependencies beyond boto3/botocore
# (already in the Lambda runtime) and stdlib live in autopilot/lambda/ — the
# conductor is deliberately dependency-light (see handler.py's module
# docstring) — so a plain recursive zip of the source directory is sufficient;
# no build step (pip install into a staging dir, a la campaign_plan_lambda's
# build.sh) is needed.
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../../../autopilot/lambda"
  output_path = "${path.module}/lambda.zip"
}

resource "aws_lambda_function" "autopilot_bot" {
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
  function_name    = "autopilot-bot-${var.environment}"
  role             = aws_iam_role.autopilot_bot.arn
  handler          = "handler.handler"
  runtime          = "python3.13"
  # Matches clickup-bot's reasoning exactly: the webhook-facing path answers
  # ClickUp in milliseconds either way. 120s is budget for the ASYNC WORKER
  # invocation (route_event: DynamoDB claim + ClickUp reads + ECS RunTask),
  # not the fast-ack path.
  timeout     = 120
  memory_size = 128

  environment {
    variables = {
      # Always present, unconditionally: an unset AUTOPILOT_LIST_IDS or
      # AUTOPILOT_BOT_USER_ID must fail CLOSED (router.py / handler.py both
      # log ERROR and refuse), never silently disable a gate.
      AUTOPILOT_LIST_IDS    = var.autopilot_list_ids
      AUTOPILOT_BOT_USER_ID = var.autopilot_bot_user_id
      AUTOPILOT_DEDUP_TABLE = aws_dynamodb_table.dedup.name

      # Sourced from Secrets Manager at apply time — see the data source's
      # comment above for why this Lambda cannot use ECS's valueFrom
      # equivalent. try(..., "") because AI_SECRETS_PROD does not carry
      # AUTOPILOT_CLICKUP_WEBHOOK_SECRET or AUTOPILOT_CLICKUP_API_KEY yet
      # (dev carries both as of 2026-09-14) — a bare index would fail
      # PLAN, not just apply, on every root until someone adds them. An
      # empty value degrades safely: verify_webhook_signature rejects every
      # request (missing secret -> always-401) and clickup_request sends an
      # empty Authorization header (ClickUp 401s it) — both fail closed, per
      # ticket ENG-11104's manual pre-launch step. SLACK_BOT_TOKEN already
      # exists in both secrets; wrapped the same way for consistency and so
      # a future rotation that drops the key can't break plan either.
      AUTOPILOT_CLICKUP_WEBHOOK_SECRET = try(local.ai_secrets["AUTOPILOT_CLICKUP_WEBHOOK_SECRET"], "")
      AUTOPILOT_CLICKUP_API_KEY        = try(local.ai_secrets["AUTOPILOT_CLICKUP_API_KEY"], "")
      SLACK_BOT_TOKEN                  = try(local.ai_secrets["SLACK_BOT_TOKEN"], "")
      # Same Delegate App key the autopilot-agent-fargate task definitions
      # already carry (see that module's agent_secrets local) — the sweep's
      # merge-pending resolution pass (lambda/github_auth.py) mints its own
      # short-lived installation token from it to read PR merge state.
      GITHUB_APP_PRIVATE_KEY = try(local.ai_secrets["GITHUB_APP_PRIVATE_KEY"], "")

      AUTOPILOT_SLACK_CHANNEL = var.autopilot_slack_channel
      SWEEP_LOOKBACK_MINUTES  = var.sweep_lookback_minutes
      SWEEP_MAX_TRIGGERS      = var.sweep_max_triggers

      # ECS dispatch. Names are dispatch.py's exact env var names — NOT
      # ECS_SUBNET_IDS/ECS_SECURITY_GROUP_ID (clickup-bot's names): this
      # Lambda's dispatch.py reads bare SUBNET_IDS/SECURITY_GROUP_ID.
      ECS_CLUSTER_ARN                = var.ecs_cluster_arn
      ECS_TASK_DEFINITION            = var.ecs_task_definition_family
      ECS_TASK_DEFINITION_PLAYWRIGHT = var.ecs_task_definition_family_playwright
      SUBNET_IDS                     = join(",", var.ecs_subnet_ids)
      SECURITY_GROUP_ID              = var.ecs_security_group_id
    }
  }

  depends_on = [aws_cloudwatch_log_group.autopilot_bot]

  tags = {
    Environment = var.environment
    Service     = "autopilot-bot"
  }
}

# A crashed/timed-out async worker must NEVER auto-retry: it would re-run
# dedup claim + ECS dispatch, and a retry after a launch that actually
# succeeded server-side (an ambiguous ECS RunTask failure) would double-launch
# a paid Fargate run. dispatch.py already fails closed on its own claim path;
# this pins the platform side to zero retries as a backstop.
resource "aws_lambda_function_event_invoke_config" "autopilot_bot" {
  function_name          = aws_lambda_function.autopilot_bot.function_name
  maximum_retry_attempts = 0
}

# NO EventBridge schedule here. The reconciliation sweep
# (.github/workflows/autopilot-sweep.yml, merged with the base branch this
# stacks on) invokes this function directly with {"autopilot_sweep": true} on
# a GitHub Actions cron, for the identical reason clickup-bot's sweep lives in
# GitHub Actions and not here: the CI deploy role (github-actions-pulumi-
# deploy) has no `events:` IAM action, so creating an aws_cloudwatch_event_rule
# fails with AccessDenied and takes the whole apply down with it. See
# clickup-bot/main.tf's identical comment for the full account of what it
# would take to move this back into Terraform.

# Fail-loud is only loud if someone hears it. handler()/route_event()/
# supervisor.py/sweep.py all handle their own failures as structured
# 4xx/5xx returns or swallowed-and-logged errors, never an unhandled
# exception, so the Lambda "Errors" metric never fires — the only durable
# signal is the "ERROR" / "Failed to" log lines. This filter + alarm + SNS
# topic turns those into Slack/email, mirroring clickup-bot's identical
# pattern.
#
# SECURITY CONTRACT with the handler code: this pattern is a substring OR
# evaluated against EVERY log line in the group, and the webhook endpoint is
# public. The handler must never echo unauthenticated request content (raw
# body, headers, event type, history_items) into its logs — every log line in
# handler.py today is a static string, which this filter depends on staying
# true.
#
# "Task timed out" is Lambda-runtime-emitted, not handler-emitted: at the hard
# 120s timeout the runtime prints "... Task timed out after N seconds" and the
# handler never gets to log anything. Nobody receives an HTTP error (the
# worker is an async invocation), maximum_retry_attempts = 0 stops platform
# retries, and the runtime message contains neither "ERROR" nor "Failed to" —
# without this term a timed-out worker would die with NO alarm.
resource "aws_cloudwatch_log_metric_filter" "handler_errors" {
  name           = "autopilot-bot-handler-errors-${var.environment}"
  log_group_name = aws_cloudwatch_log_group.autopilot_bot.name
  pattern        = "?\"ERROR\" ?\"Failed to\" ?\"Task timed out\""

  metric_transformation {
    name          = "HandlerErrors"
    namespace     = "AutopilotBot/${var.environment}"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_sns_topic" "bot_failures" {
  name = "autopilot-bot-failures-${var.environment}"

  tags = {
    Name        = "Autopilot Bot Failures"
    Environment = var.environment
    Service     = "autopilot-bot"
  }
}

resource "aws_sns_topic_policy" "bot_failures" {
  arn = aws_sns_topic.bot_failures.arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "cloudwatch.amazonaws.com"
        }
        Action   = "SNS:Publish"
        Resource = aws_sns_topic.bot_failures.arn
        Condition = {
          StringEquals = {
            "AWS:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      }
    ]
  })
}

resource "aws_sns_topic_subscription" "bot_failures_email" {
  count     = var.failure_notification_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.bot_failures.arn
  protocol  = "email"
  endpoint  = var.failure_notification_email
}

resource "aws_sns_topic_subscription" "shared_slack_notifier" {
  count     = var.shared_slack_notifier_lambda_arn != "" ? 1 : 0
  topic_arn = aws_sns_topic.bot_failures.arn
  protocol  = "lambda"
  endpoint  = var.shared_slack_notifier_lambda_arn
}

resource "aws_lambda_permission" "allow_sns_invoke_slack" {
  count = var.shared_slack_notifier_lambda_arn != "" ? 1 : 0
  # The notifier lambda is ONE shared function across environments
  # (shared/slack-notifier state), and permission statement ids are unique per
  # function — an un-suffixed id lets whichever environment applies first win
  # and fails the other with ResourceConflictException (prod, run 34764275079).
  statement_id  = "AllowSNSInvokeFromAutopilotBotFailures-${var.environment}"
  action        = "lambda:InvokeFunction"
  function_name = var.shared_slack_notifier_lambda_arn
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.bot_failures.arn
}

resource "aws_cloudwatch_metric_alarm" "handler_errors" {
  alarm_name          = "autopilot-bot-handler-errors-${var.environment}"
  alarm_description   = "autopilot-bot ${var.environment} logged handler errors (fail-loud 4xx/5xx, a routed dispatch that refused to fire, or an async worker hard timeout — 'Task timed out': check for a stranded DynamoDB claim). Check /aws/lambda/autopilot-bot-${var.environment} logs. Stranded claim: scan table autopilot-dedup-${var.environment} for the task's pk and delete-item it to unblock a re-entry."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "HandlerErrors"
  namespace           = "AutopilotBot/${var.environment}"
  period              = 300
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.bot_failures.arn]
  ok_actions          = [aws_sns_topic.bot_failures.arn]

  tags = {
    Environment = var.environment
    Service     = "autopilot-bot"
  }
}

# treat_missing_data = "breaching" is deliberate, mirroring clickup-bot's
# identical alarm: Lambda invocation metrics are SPARSE (no invocations means
# no datapoint, not a datapoint of zero), so the default (missing = ignore)
# would leave this alarm permanently INSUFFICIENT_DATA during exactly the
# outage — a suspended/never-registered webhook — it exists to catch.
#
# This is why no_deliveries_alarm_enabled exists: this alarm is RED from the
# moment this Lambda first deploys until a real ClickUp webhook is pointed at
# it, which is a separate, later step. The toggle controls only alarm_actions/
# ok_actions, never treat_missing_data or the alarm's existence, so the signal
# stays visible in the CloudWatch console either way — only the Slack/email
# noise is muted.
resource "aws_cloudwatch_metric_alarm" "no_deliveries" {
  alarm_name          = "autopilot-bot-no-deliveries-${var.environment}"
  alarm_description   = "autopilot-bot ${var.environment} has received NO webhook deliveries for 4 days. Expected until a ClickUp webhook is registered against this Lambda's ALB path (/autopilot/webhook) — see ENG-11104. Once registered and live, this firing means the bot is not being called: check the webhook's health status and owning token."
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 4
  datapoints_to_alarm = 4
  metric_name         = "Invocations"
  namespace           = "AWS/Lambda"
  period              = 86400
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "breaching"
  alarm_actions       = var.no_deliveries_alarm_enabled ? [aws_sns_topic.bot_failures.arn] : []
  ok_actions          = var.no_deliveries_alarm_enabled ? [aws_sns_topic.bot_failures.arn] : []

  dimensions = {
    FunctionName = aws_lambda_function.autopilot_bot.function_name
  }

  tags = {
    Environment = var.environment
    Service     = "autopilot-bot"
  }
}

output "lambda_function_arn" {
  value       = aws_lambda_function.autopilot_bot.arn
  description = "Lambda function ARN"
}

output "lambda_function_name" {
  value       = aws_lambda_function.autopilot_bot.function_name
  description = "Lambda function name"
}

output "failure_sns_topic_arn" {
  value       = aws_sns_topic.bot_failures.arn
  description = "SNS topic that receives autopilot-bot handler error alarms"
}
