variable "environment" {
  description = "Environment name (dev, prod)"
  type        = string
}

variable "ecs_cluster_arn" {
  description = "ARN of the ECS cluster to run engineer-agent tasks"
  type        = string
  default     = ""
}

variable "ecs_task_definition_arn" {
  description = "ARN of the ECS task definition for engineer-agent"
  type        = string
  default     = ""
}

variable "ecs_task_definition_family" {
  description = "Family name of the ECS task definition (uses latest revision automatically)"
  type        = string
  default     = ""
}

variable "ecs_subnet_ids" {
  description = "Subnet IDs for ECS tasks"
  type        = list(string)
  default     = []
}

variable "ecs_security_group_id" {
  description = "Security group ID for ECS tasks"
  type        = string
  default     = ""
}

variable "ecs_task_execution_role_arn" {
  description = "Task execution role ARN for ECS tasks"
  type        = string
  default     = ""
}

variable "ecs_task_role_arn" {
  description = "Task role ARN for ECS tasks"
  type        = string
  default     = ""
}

variable "enable_fargate_trigger" {
  description = "Whether to enable Fargate task triggering (requires ECS variables to be set)"
  type        = bool
  default     = false
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

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

resource "aws_cloudwatch_log_group" "clickup_bot" {
  name = "/aws/lambda/clickup-bot-${var.environment}"
  # Matches the agent's log group (see engineer-agent-fargate), and for a
  # related reason: this is where delivery history lives, which is the only way
  # to answer how many reported bugs the bot actually saw. That question is not
  # academic here — a suspended webhook dropped every bug for two weeks from
  # 2026-07-31 while looking healthy, and reconstructing the size of that gap
  # afterwards depended entirely on these lines still existing.
  retention_in_days = 400

  tags = {
    Environment = var.environment
    Service     = "clickup-bot"
  }
}

resource "aws_iam_role" "clickup_bot" {
  name = "clickup-bot-lambda-${var.environment}"

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
    Service     = "clickup-bot"
  }
}

resource "aws_iam_role_policy_attachment" "clickup_bot_basic" {
  role       = aws_iam_role.clickup_bot.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "clickup_bot_secrets" {
  name = "secrets-manager-access"
  role = aws_iam_role.clickup_bot.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:AI_SECRETS_${upper(var.environment)}-??????"
      }
    ]
  })
}

resource "aws_iam_role_policy" "clickup_bot_ecs" {
  count = var.enable_fargate_trigger ? 1 : 0
  name  = "ecs-run-task"
  role  = aws_iam_role.clickup_bot.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecs:RunTask"
        ]
        Resource = [
          "arn:aws:ecs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:task-definition/${var.ecs_task_definition_family}:*"
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

# Atomic dedup claims (2026-07-14 incident). Comment-based dedup reads through
# ClickUp's slow, eventually-consistent API, so concurrent worker invocations
# can all pass it before any ack comment is visible — one retried webhook
# delivery launched six Fargate agents. The handler's authoritative dedup is a
# conditional PutItem into this table keyed "{task_id}#{label}"; DynamoDB
# serializes conditional writes, so exactly one invocation wins the claim.
# expires_at (epoch seconds, written by the handler) lets DynamoDB TTL garbage-
# collect old claims; the handler additionally treats an expired-but-not-yet-
# deleted claim as free, because TTL deletion can lag hours. PAY_PER_REQUEST:
# traffic is a handful of writes per gpbot tag event — provisioning capacity
# would cost more than the requests.
resource "aws_dynamodb_table" "dedup" {
  name         = "clickup-bot-dedup-${var.environment}"
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
    Service     = "clickup-bot"
  }
}

# PutItem acquires a claim, DeleteItem releases it after a failed launch (so
# the remove-and-re-add-the-tag retry contract survives launch failures).
# Nothing else: the handler never reads the table, so no GetItem/Query.
resource "aws_iam_role_policy" "clickup_bot_dedup" {
  name = "dedup-table-access"
  role = aws_iam_role.clickup_bot.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:DeleteItem"
        ]
        Resource = aws_dynamodb_table.dedup.arn
      }
    ]
  })
}

# Self-invoke permission for the fast-ack flow: the webhook invocation answers
# ClickUp in milliseconds and re-invokes this same function asynchronously to
# do the ClickUp/ECS work off the critical path (ClickUp's webhook response
# timeout is what turned one slow delivery into six retries on 2026-07-14).
# Until this policy is applied, the handler quietly falls back to the old
# synchronous flow — applying this grant is what activates fast-ack.
# The ARN is CONSTRUCTED from the data sources rather than referencing
# aws_lambda_function.clickup_bot.arn: the function depends on the role, so a
# role policy referencing the function would be a dependency cycle.
resource "aws_iam_role_policy" "clickup_bot_self_invoke" {
  name = "self-invoke"
  role = aws_iam_role.clickup_bot.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "lambda:InvokeFunction"
        ]
        Resource = "arn:aws:lambda:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:function:clickup-bot-${var.environment}"
      }
    ]
  })
}

# Terraform owns this Lambda's code, as of 2026-08-10.
#
# It used to only seed the code at creation, with an ignore_changes on filename
# and source_code_hash, because deploys were hand-run `terraform apply` from
# whatever a developer had checked out — a stale checkout could silently roll
# prod code back, so .github/workflows/deploy-clickup-bot.yml was made the single
# code writer instead.
#
# Both halves of that premise are gone. Applies run in CI from the exact promoted
# SHA, never a laptop, so there is no stale checkout to defend against; and that
# workflow did not come across in the move to omni, which left this Lambda's code
# with no deploy path at all. Dropping ignore_changes puts it back on the
# promotion train with every other gp-ai component.
#
# archive_file's hash is stable for unchanged source (verified against prod:
# two consecutive plans produced the same target hash), so this does not churn
# the function on every apply.
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_file = "${path.module}/../../../clickup_bot/lambda/handler.py"
  output_path = "${path.module}/lambda.zip"
}

resource "aws_lambda_function" "clickup_bot" {
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
  function_name    = "clickup-bot-${var.environment}"
  role             = aws_iam_role.clickup_bot.arn
  handler          = "handler.handler"
  runtime          = "python3.13"
  # 120s, NOT the old 30s: the webhook-facing path answers ClickUp in
  # milliseconds either way — this long budget exists for the ASYNC WORKER
  # invocation, whose worst-case in-flight blocking is documented at ~45s
  # (comments GET 10s + PutItem + run_task on botocore defaults + ack 10s +
  # 2s pause + retry ack 10s). At 30s a worker could be killed mid-flight:
  # silently (the runtime's "Task timed out" is matched by the metric filter
  # below precisely for this), unretried (maximum_retry_attempts = 0), and
  # possibly stranding a dedup claim written before run_task. The hard
  # timeout is a backstop, not a target.
  timeout     = 120
  memory_size = 128


  environment {
    variables = merge(
      {
        ENVIRONMENT = var.environment
        # Always present (not fargate-gated): the handler treats an unset
        # DEDUP_TABLE_NAME as "comment-based dedup only", so this var going
        # missing would silently disable atomic dedup — the same failure shape
        # as the 2026-06-26 tfvars incident. Keep it in the unconditional map.
        DEDUP_TABLE_NAME = aws_dynamodb_table.dedup.name
      },
      var.enable_fargate_trigger ? {
        # Transition compatibility — do NOT remove until the fail-loud handler
        # is confirmed live in prod. The current handler ignores ENABLE_FARGATE
        # (there is no logging-only mode anymore), but the PREVIOUS handler
        # gates on it and silently no-ops (logs HANDOFF_DATA, returns 200)
        # when it is absent. Keeping it means a `terraform apply` that runs
        # before the prod-branch code deploy still restores the old deployed
        # code to a working state instead of re-creating the 12-day silent
        # incident (2026-06-26).
        ENABLE_FARGATE        = "true"
        ECS_CLUSTER_ARN       = var.ecs_cluster_arn
        ECS_TASK_DEFINITION   = var.ecs_task_definition_family != "" ? var.ecs_task_definition_family : var.ecs_task_definition_arn
        ECS_SUBNET_IDS        = join(",", var.ecs_subnet_ids)
        ECS_SECURITY_GROUP_ID = var.ecs_security_group_id
      } : {}
    )
  }

  depends_on = [aws_cloudwatch_log_group.clickup_bot]

  tags = {
    Environment = var.environment
    Service     = "clickup-bot"
  }
}

# Defense in depth for the fast-ack worker: Lambda retries a FAILED async
# ("Event") invocation twice by default, and a retried worker would re-run
# dedup+trigger — recreating exactly the duplicate-launch bug this design
# fixes if the first attempt crashed after acquiring nothing. The handler
# already never lets an exception escape the worker path by design; this
# pins the platform side to zero retries in case that invariant ever slips.
resource "aws_lambda_function_event_invoke_config" "clickup_bot" {
  function_name          = aws_lambda_function.clickup_bot.function_name
  maximum_retry_attempts = 0
}

# RECONCILIATION SWEEP.
#
# The webhook is not a complete feed, and that is measured: of the 53 tasks
# created workspace-wide on 2026-08-17 after the taskCreated subscription went
# live, the only one that produced no delivery at all was the single
# HubSpot-filed ticket — the exact class this bot serves. See the SWEEP block in
# handler.py.
#
# This also covers the failure that actually hurt: a webhook ClickUp suspends
# stops delivering silently, as it did for two weeks from 2026-07-31. A schedule
# cannot be unsubscribed, so the bot degrades to "up to one interval late"
# instead of "off, and nothing looks wrong".
# THE SCHEDULE LIVES IN GITHUB ACTIONS, NOT HERE: see
# .github/workflows/gpbot-sweep.yml.
#
# It was written as an aws_cloudwatch_event_rule first, and that is still the
# better shape — a rule in the same state as the function it invokes, with no
# dependency on a CI runner. It cannot be applied. The role CI deploys with
# (github-actions-pulumi-deploy) grants lambda:* but has no `events:` action at
# all, so creating the rule fails with AccessDenied and takes the whole
# prod/clickup-bot apply down with it — including the function code update that
# had already succeeded, leaving the sweep code deployed with nothing to trigger
# it. The pre-existing rules elsewhere in this stack do not disprove this: they
# were created out-of-band and their applies are no-ops now.
#
# The workflow invokes this function directly with {"gpbot_sweep": true}, which
# lambda:* does permit, so the trigger needs no permission the deploy already
# has. The cost is that GitHub's cron is best-effort and can run late — which
# this particular job can absorb, because it is a backstop with a 24-hour
# lookback and a permanent per-ticket idempotency check, not a latency-sensitive
# path.
#
# To move it back here: add events:PutRule, PutTargets, DeleteRule,
# RemoveTargets, DescribeRule, ListTargetsByRule and TagResource to
# GitHubActionsPulumiDeployPolicy, then restore the rule/target/permission trio
# and delete the workflow.

# Fail-loud is only loud if someone hears it. The handler's failures are
# handled returns (structured 500s/401s), not Lambda invocation errors, so the
# AWS "Errors" metric never fires — the only durable signal is the "ERROR" /
# "Failed to" log lines (including comment posts that post_failure_comment
# deliberately swallows, and signature-verification 401s that would otherwise
# end in ClickUp silently suspending the webhook). This filter + alarm + SNS
# topic turns those lines into Slack/email notifications, mirroring the
# engineer-agent-failures-{env} pattern. Without it, the failures accumulate in
# metrics nobody watches, which is operationally identical to the 12-day
# silence this module exists to prevent.
#
# SECURITY CONTRACT with the handler: this pattern is a substring OR evaluated
# against EVERY log line in the group, and the webhook endpoint is public. The
# handler must therefore never echo unauthenticated request content (raw body,
# headers, event type, history_items) to its logs — otherwise any internet
# client could fire this alarm, or bury it in false positives, by sending
# "ERROR" in a request body. Both sides of the contract are locked by
# clickup_bot/tests/test_handler.py (ALARM_FILTER_TERMS and the alarm-log
# poisoning tests); change the pattern and those tests together.
#
# "Task timed out" is the THIRD term, and it is runtime-emitted, not
# handler-emitted: when the function hits its hard timeout the Lambda runtime
# prints "... Task timed out after N seconds" and the handler never gets to
# log anything. Nobody receives an HTTP error (the worker is an async
# invocation), maximum_retry_attempts = 0 stops platform retries, and the
# runtime message contains neither "ERROR" nor "Failed to" — without this
# term a timed-out worker would die with NO alarm. It is deliberately absent
# from ALARM_FILTER_TERMS in test_handler.py: handler code never emits that
# string, so the test-side contract (which polices handler log lines) has
# nothing to check for it.
resource "aws_cloudwatch_log_metric_filter" "handler_errors" {
  name           = "clickup-bot-handler-errors-${var.environment}"
  log_group_name = aws_cloudwatch_log_group.clickup_bot.name
  pattern        = "?\"ERROR\" ?\"Failed to\" ?\"Task timed out\""

  metric_transformation {
    name          = "HandlerErrors"
    namespace     = "ClickUpBot/${var.environment}"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_sns_topic" "bot_failures" {
  name = "clickup-bot-failures-${var.environment}"

  tags = {
    Name        = "ClickUp Bot Failures"
    Environment = var.environment
    Service     = "clickup-bot"
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
  count         = var.shared_slack_notifier_lambda_arn != "" ? 1 : 0
  statement_id  = "AllowSNSInvokeFromClickupBotFailures"
  action        = "lambda:InvokeFunction"
  function_name = var.shared_slack_notifier_lambda_arn
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.bot_failures.arn
}

resource "aws_cloudwatch_metric_alarm" "handler_errors" {
  alarm_name          = "clickup-bot-handler-errors-${var.environment}"
  alarm_description   = "clickup-bot ${var.environment} logged handler errors (fail-loud 500s, swallowed ClickUp comment failures, or an async worker hard timeout — 'Task timed out': work possibly lost, check for stranded dedup claims). Check /aws/lambda/clickup-bot-${var.environment} logs. Stranded claim: scan table clickup-bot-dedup-${var.environment} (aws dynamodb scan) and delete-item the pk '{task_id}#{label}' to unblock re-tag (see clickup_bot/README.md, 'Stranded dedup claims'). After any sustained outage, also check the ClickUp webhook health status (see clickup_bot/README.md, 'After an outage')."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "HandlerErrors"
  namespace           = "ClickUpBot/${var.environment}"
  period              = 300
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.bot_failures.arn]
  ok_actions          = [aws_sns_topic.bot_failures.arn]

  tags = {
    Environment = var.environment
    Service     = "clickup-bot"
  }
}

# SILENCE ALARM. The handler_errors alarm above can only fire if the handler
# RUNS, so it is blind to the one failure mode that has actually happened:
# ClickUp stopping delivery altogether. Deliveries stopped on 2026-07-31 —
# zero requests reached the ALB target group and zero invocations followed —
# and nothing alarmed for 12 days, because a webhook that never fires produces
# no error logs. "A suspended webhook is indistinguishable from a quiet one"
# was in the runbook as something to check by hand; this makes it check itself.
#
# treat_missing_data = "breaching" is the entire point. Lambda metrics are
# SPARSE: no invocations means no datapoint at all, not a datapoint of zero, so
# the default (missing = ignore) would leave this alarm permanently INSUFFICIENT
# _DATA during exactly the outage it exists to catch.
#
# Four days, not one. The webhook fires on taskTagUpdated for the whole
# workspace, so weekday traffic is 5-35/day, but a quiet Saturday legitimately
# reaches zero (2026-07-25 did). Four consecutive silent days is well past any
# observed gap, including a long weekend, and still turns a 12-day blind spot
# into a 4-day one.
resource "aws_cloudwatch_metric_alarm" "no_deliveries" {
  alarm_name          = "clickup-bot-no-deliveries-${var.environment}"
  alarm_description   = "clickup-bot ${var.environment} has received NO webhook deliveries for 4 days. The bot is not broken — it is not being called. Check the ClickUp webhook's health status and that its owning token still has workspace access (see clickup_bot/README.md, 'After an outage'). A webhook registered with a personal token dies when that person loses workspace access, which is how deliveries stopped on 2026-07-31."
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 4
  datapoints_to_alarm = 4
  metric_name         = "Invocations"
  namespace           = "AWS/Lambda"
  period              = 86400
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.bot_failures.arn]
  ok_actions          = [aws_sns_topic.bot_failures.arn]

  dimensions = {
    FunctionName = aws_lambda_function.clickup_bot.function_name
  }

  tags = {
    Environment = var.environment
    Service     = "clickup-bot"
  }
}

output "lambda_function_arn" {
  value       = aws_lambda_function.clickup_bot.arn
  description = "Lambda function ARN"
}

output "failure_sns_topic_arn" {
  value       = aws_sns_topic.bot_failures.arn
  description = "SNS topic that receives clickup-bot handler error alarms"
}

output "lambda_function_name" {
  value       = aws_lambda_function.clickup_bot.function_name
  description = "Lambda function name"
}

output "lambda_invoke_arn" {
  value       = aws_lambda_function.clickup_bot.invoke_arn
  description = "Lambda invoke ARN for API Gateway/ALB"
}
