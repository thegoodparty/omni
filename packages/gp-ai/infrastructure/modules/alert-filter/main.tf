variable "environment" {
  description = "Environment name (dev, prod)"
  type        = string
}

variable "mode" {
  description = <<-EOT
    `shadow` or `enforce`.

    shadow  — the filtered channel behaves exactly as it does today, mentions
              and all, while the raw channel threads and GPALERT_METRIC record
              what the filter WOULD have done. This is how the feature ships:
              the suppress list is a decision about what nobody gets told, and
              it should be reviewed against a week of real firings before it
              starts taking effect.
    enforce — the routing is applied.

    The handler reads anything other than `enforce` as shadow, so a typo here
    is a no-op rather than a channel going quiet.
  EOT
  type        = string
  default     = "shadow"

  validation {
    # Rejected at plan time even though the handler tolerates it. The failure
    # this prevents is the reverse of the handler's: someone sets "enforced" or
    # "on", intends enforcement, gets shadow, and concludes from a quiet Slack
    # that the filter is working.
    condition     = contains(["shadow", "enforce"], var.mode)
    error_message = "mode must be exactly \"shadow\" or \"enforce\"."
  }
}

variable "raw_channel_id" {
  description = <<-EOT
    Slack channel for EVERY alert, unfiltered, including the ones the filter
    suppresses. Each post gets a threaded reply saying what the filter decided.

    This is the channel that makes the whole design safe to run: there is no
    outcome in which an alert Grafana delivered reaches nobody, so the worst bug
    in the filter costs a reader a channel switch rather than an incident. An
    empty value is refused for that reason.
  EOT
  type        = string

  validation {
    condition     = length(var.raw_channel_id) > 0
    error_message = "raw_channel_id is required: without it, a suppressed alert would reach nobody."
  }
}

variable "filtered_channel_id" {
  description = "Slack channel for alerts the filter decided a human should see (today's #dev-alerts)."
  type        = string
}

variable "urgent_channel_id" {
  description = "Slack channel that mirrors alerts judged urgent. Empty disables the mirror; the ping still happens in the filtered channel."
  type        = string
  default     = ""
}

variable "slack_workspace_domain" {
  description = "Workspace subdomain, used only to build a permalink back to the raw post from the urgent mirror."
  type        = string
  default     = ""
}

variable "loki_url" {
  description = "Grafana Cloud Loki base URL, e.g. https://logs-prod-021.grafana.net. Empty disables evidence gathering, which degrades every decision to notify."
  type        = string
  default     = ""
}

variable "loki_user" {
  description = "Grafana Cloud Loki stack user (numeric). Empty disables evidence gathering."
  type        = string
  default     = ""
}

variable "shared_slack_notifier_lambda_arn" {
  description = "ARN of the shared Slack notifier Lambda to subscribe to failure notifications (empty disables)"
  type        = string
  default     = ""
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

# 400 days, matching clickup-bot's and the agent's, and for a reason specific to
# this Lambda: these logs ARE the audit trail for suppression. GPALERT_METRIC
# lines are how the weekly digest answers "what did we stop showing people", and
# a retention shorter than a review cycle would mean the answer expires before
# anyone asks the question.
resource "aws_cloudwatch_log_group" "alert_filter" {
  name              = "/aws/lambda/alert-filter-${var.environment}"
  retention_in_days = 400

  tags = {
    Environment = var.environment
    Service     = "alert-filter"
  }
}

resource "aws_iam_role" "alert_filter" {
  name = "alert-filter-lambda-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action    = "sts:AssumeRole"
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
      }
    ]
  })

  tags = {
    Environment = var.environment
    Service     = "alert-filter"
  }
}

resource "aws_iam_role_policy_attachment" "alert_filter_basic" {
  role       = aws_iam_role.alert_filter.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Same secret bundle the rest of gp-ai reads. The handler pulls the Slack bot
# token, the Anthropic key, the Loki token and the webhook shared secret out of
# it at cold start, so none of them appear in the function's environment — where
# `aws lambda get-function-configuration` would show them to anyone with read
# access, and where Terraform state would keep them in plaintext.
resource "aws_iam_role_policy" "alert_filter_secrets" {
  name = "secrets-manager-access"
  role = aws_iam_role.alert_filter.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:AI_SECRETS_${upper(var.environment)}-??????"
      }
    ]
  })
}

# Replay dedup. Grafana retries a delivery it did not get a 2xx for, with the
# same fingerprints — so without this a single slow Loki query turns one alert
# into three Slack posts and three model calls. Keyed
# "alert#{fingerprint}#{startsAt}": the fingerprint identifies the label set and
# is stable across firings, so it cannot be the whole key or the SECOND real
# firing of an alert would be swallowed.
#
# PAY_PER_REQUEST because the traffic is one write per alert notification, and
# provisioned capacity would cost more than the requests.
resource "aws_dynamodb_table" "dedup" {
  name         = "alert-filter-dedup-${var.environment}"
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
    Service     = "alert-filter"
  }
}

# PutItem only. The handler's claim is a conditional write whose failure IS the
# answer, so it never reads the table and never deletes from it — unlike
# clickup_bot, there is nothing to release: a handled alert stays handled, and
# TTL is what frees the key.
resource "aws_iam_role_policy" "alert_filter_dedup" {
  name = "dedup-table-access"
  role = aws_iam_role.alert_filter.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem"]
        Resource = aws_dynamodb_table.dedup.arn
      }
    ]
  })
}

# The zip carries handler.py at the root and the pure modules under
# alert_filter/, because the handler imports them and Lambda puts the archive
# root on sys.path.
#
# ASSEMBLED FROM A FILESET rather than listed file by file, so adding a module
# to alert_filter/ packages it automatically. A hand-maintained list is the kind
# of thing that goes stale silently: the missing import surfaces as an
# invocation error on the first alert after a deploy, which is to say in the
# middle of an incident.
#
# The `*.py` glob is top-level only, so tests/ and __pycache__/ stay out of the
# artifact without needing an exclude list.
data "archive_file" "lambda_zip" {
  type        = "zip"
  output_path = "${path.module}/lambda.zip"

  source {
    content  = file("${path.module}/../../../alert_filter/lambda/handler.py")
    filename = "handler.py"
  }

  dynamic "source" {
    for_each = fileset("${path.module}/../../../alert_filter", "*.py")
    content {
      content  = file("${path.module}/../../../alert_filter/${source.value}")
      filename = "alert_filter/${source.value}"
    }
  }
}

resource "aws_lambda_function" "alert_filter" {
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
  function_name    = "alert-filter-${var.environment}"
  role             = aws_iam_role.alert_filter.arn
  handler          = "handler.handler"
  runtime          = "python3.13"

  # 60s, and the ceiling is set by GRAFANA rather than by the work. A grouped
  # delivery of 20 alerts (the contact point's maxAlerts) runs up to 20 Loki
  # queries at an 8s timeout and 20 model calls at 20s, which in the worst case
  # exceeds any sane Lambda timeout — but a timeout here is not merely slow, it
  # is a delivery Grafana did not get a 2xx for and will retry. So the budget is
  # deliberately shorter than the retry is patient: better to fail one delivery
  # fast, with the dedup claims already written, than to be killed mid-group.
  timeout = 60

  # The pure modules hold at most 50 log lines per cause in memory and hand them
  # to an HTTP call. Nothing here is memory-bound; this is the floor.
  memory_size = 256

  environment {
    variables = {
      ENVIRONMENT = var.environment
      # The one variable that decides whether this system is visible. Always
      # present, so it can never be "unset and therefore whatever the handler
      # defaults to" — the handler's default is shadow, which is safe, but a
      # reader of the console should be able to see which mode prod is in
      # without knowing the handler's code.
      ALERT_FILTER_MODE = var.mode

      RAW_CHANNEL_ID      = var.raw_channel_id
      FILTERED_CHANNEL_ID = var.filtered_channel_id
      URGENT_CHANNEL_ID   = var.urgent_channel_id

      SLACK_WORKSPACE_DOMAIN = var.slack_workspace_domain

      # Non-secret halves only. The token comes from Secrets Manager.
      LOKI_URL  = var.loki_url
      LOKI_USER = var.loki_user

      DEDUP_TABLE_NAME = aws_dynamodb_table.dedup.name
    }
  }

  depends_on = [aws_cloudwatch_log_group.alert_filter]

  tags = {
    Environment = var.environment
    Service     = "alert-filter"
  }
}

# The handler's failures are handled 200s, not invocation errors, for the reason
# in its header: a 5xx asks Grafana to redeliver, and a redelivery after a
# successful post is a duplicate. So the AWS "Errors" metric is blind to
# everything that matters here and the only durable signal is the log lines.
#
# SECURITY CONTRACT, same as clickup-bot's and for the same reason: this pattern
# is a substring match over every line in the group, and the endpoint is public.
# The handler must never echo unauthenticated request content to its logs, or
# anyone on the internet could fire this alarm — or bury it — by putting "ERROR"
# in a request body. The handler logs nothing from the body before
# `_authenticated` has passed.
resource "aws_cloudwatch_log_metric_filter" "handler_errors" {
  name           = "alert-filter-handler-errors-${var.environment}"
  log_group_name = aws_cloudwatch_log_group.alert_filter.name
  pattern        = "?\"ERROR\" ?\"Task timed out\""

  metric_transformation {
    name          = "HandlerErrors"
    namespace     = "AlertFilter/${var.environment}"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_sns_topic" "failures" {
  name = "alert-filter-failures-${var.environment}"

  tags = {
    Name        = "Alert Filter Failures"
    Environment = var.environment
    Service     = "alert-filter"
  }
}

resource "aws_sns_topic_policy" "failures" {
  arn = aws_sns_topic.failures.arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "cloudwatch.amazonaws.com" }
        Action    = "SNS:Publish"
        Resource  = aws_sns_topic.failures.arn
        Condition = {
          StringEquals = { "AWS:SourceAccount" = data.aws_caller_identity.current.account_id }
        }
      }
    ]
  })
}

resource "aws_sns_topic_subscription" "shared_slack_notifier" {
  count     = var.shared_slack_notifier_lambda_arn != "" ? 1 : 0
  topic_arn = aws_sns_topic.failures.arn
  protocol  = "lambda"
  endpoint  = var.shared_slack_notifier_lambda_arn
}

resource "aws_lambda_permission" "allow_sns_invoke_slack" {
  count         = var.shared_slack_notifier_lambda_arn != "" ? 1 : 0
  statement_id  = "AllowSNSInvokeFromAlertFilterFailures"
  action        = "lambda:InvokeFunction"
  function_name = var.shared_slack_notifier_lambda_arn
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.failures.arn
}

# THIS ALARM MUST NOT DEPEND ON THE FILTER, which is why it is a CloudWatch
# alarm to SNS rather than a Grafana rule: the filter breaking is exactly the
# state in which a Grafana-delivered warning about the filter would not arrive.
# The `alert-notification-delivery-failing` rule in gp-api's alerts.ts is the
# other half of this, from Grafana's side.
resource "aws_cloudwatch_metric_alarm" "handler_errors" {
  alarm_name          = "alert-filter-handler-errors-${var.environment}"
  alarm_description   = "alert-filter ${var.environment} logged errors. Alerts may be reaching the raw channel only, or not at all. Check /aws/lambda/alert-filter-${var.environment}. TO RESTORE ALERTING IMMEDIATELY: repoint the Grafana notification policy from the gpbot-alert-filter contact point back to the plain Slack one — alerts resume unfiltered, which is always safe. See gp-ai/alert_filter/README.md."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "HandlerErrors"
  namespace           = "AlertFilter/${var.environment}"
  period              = 300
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.failures.arn]
  ok_actions          = [aws_sns_topic.failures.arn]

  tags = {
    Environment = var.environment
    Service     = "alert-filter"
  }
}

# SILENCE ALARM, and it is a different question here than it is for clickup-bot.
#
# There, zero invocations meant the webhook had been suspended. Here, zero
# invocations is AMBIGUOUS and mostly good: a week in which no alert fired is a
# week worth having. So this cannot alarm on silence the way clickup-bot's does
# without crying wolf on the best possible outcome.
#
# What it catches instead is the narrow case that is unambiguously broken:
# Grafana is still routing to this contact point and the function is not being
# invoked at all for a week. Any real alerting stack fires something in seven
# days — the door-knocking rules alone have not gone that quiet — so 7 silent
# days while the route is live means the route is not actually live, which is
# the misconfiguration that looks most like success.
#
# Seven days is a CloudWatch ceiling, not a tuning choice: an alarm with
# period >= 3600 must satisfy EvaluationPeriods * Period <= 604800 (one week),
# so PutMetricAlarm rejects the 14-day version of this alarm outright.
#
# treat_missing_data = "breaching" is the point, as it is for clickup-bot:
# Lambda metrics are sparse, so no invocations produces no datapoint rather than
# a zero, and the default would leave this permanently INSUFFICIENT_DATA during
# exactly the state it exists to catch.
resource "aws_cloudwatch_metric_alarm" "no_deliveries" {
  alarm_name          = "alert-filter-no-deliveries-${var.environment}"
  alarm_description   = "alert-filter ${var.environment} has received NO alert deliveries for 7 days. Either nothing has fired in a week (check #dev-alerts-raw — if it has traffic, this is wrong) or the Grafana notification policy is no longer routing to the gpbot-alert-filter contact point. The second case looks exactly like the filter working perfectly."
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 7
  datapoints_to_alarm = 7
  metric_name         = "Invocations"
  namespace           = "AWS/Lambda"
  period              = 86400
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.failures.arn]
  ok_actions          = [aws_sns_topic.failures.arn]

  dimensions = {
    FunctionName = aws_lambda_function.alert_filter.function_name
  }

  tags = {
    Environment = var.environment
    Service     = "alert-filter"
  }
}

output "lambda_function_arn" {
  value       = aws_lambda_function.alert_filter.arn
  description = "Lambda function ARN"
}

output "lambda_function_name" {
  value       = aws_lambda_function.alert_filter.function_name
  description = "Lambda function name"
}

output "failure_sns_topic_arn" {
  value       = aws_sns_topic.failures.arn
  description = "SNS topic that receives alert-filter error alarms"
}

output "mode" {
  value       = var.mode
  description = "Whether the filter is enforcing its decisions or only recording them"
}
