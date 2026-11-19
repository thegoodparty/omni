# The case scout's AWS infrastructure: its bucket and the Publisher Lambda.
# The reader runs in gp-api (packages/gp-api/src/caseScout), which writes the
# night's files to this bucket and invokes this Lambda; gp-api's task role
# holds those grants (packages/gp-api/deploy/index.ts). See
# case_scout/tests/test_packaging.py for the Lambda zip's own coverage check.

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

# --- Bucket ------------------------------------------------------------
#
# "One bucket, whose create-only-if-missing writes replace a database table"
# (TDD, "New infra"). Terraform owns its existence and settings; the scout's
# own code treats every key under it as create-only (marker.json's If-Match,
# claims/<runId>'s If-None-Match) — see gp-api's caseScoutBucket.service.ts. No lifecycle
# rule deletes anything here: a scout bucket holds its own history
# (processed session ids, the ledger) that later runs depend on reading back.

resource "aws_s3_bucket" "scout" {
  bucket = "case-scout-${var.environment}"

  lifecycle {
    # A bucket holding the scout's own append-only ledger and its marker
    # must never be destroyed by an unrelated apply mistake (e.g. a renamed
    # variable that Terraform reads as "replace this resource").
    prevent_destroy = true
  }

  tags = {
    Environment = var.environment
    Service     = "case-scout"
  }
}

resource "aws_s3_bucket_versioning" "scout" {
  bucket = aws_s3_bucket.scout.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "scout" {
  bucket = aws_s3_bucket.scout.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "scout" {
  bucket = aws_s3_bucket.scout.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# --- Lambda: the Publisher ----------------------------------------------

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/case-scout-${var.environment}"
  retention_in_days = 400

  tags = {
    Environment = var.environment
    Service     = "case-scout"
  }
}

resource "aws_iam_role" "lambda" {
  name = "case-scout-lambda-${var.environment}"

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
    Service     = "case-scout"
  }
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# The Publisher's bundle, sources and record reads and its marker and ledger
# writes — scoped to this bucket alone, nothing else in the account.
resource "aws_iam_role_policy" "lambda_bucket" {
  name = "scout-bucket-access"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = "${aws_s3_bucket.scout.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.scout.arn
      }
    ]
  })
}

# Read-only on the SAME shared AI_SECRETS_<ENV> bundle every other gp-ai
# Lambda reads (github_auth.py's GITHUB_APP_PRIVATE_KEY lives here). This
# policy's Resource is scoped to exactly one Secrets Manager ARN prefix.
resource "aws_iam_role_policy" "lambda_secrets" {
  name = "secrets-manager-access"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = "arn:aws:secretsmanager:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:secret:AI_SECRETS_${upper(var.environment)}-??????"
      }
    ]
  })
}

# The zip carries handler.py at the root and case_scout's pure modules
# beside it, exactly like alert_filter's own archive_file block — see
# case_scout/tests/test_packaging.py, which checks this glob still covers
# everything the handler (transitively) imports.
data "archive_file" "lambda_zip" {
  type        = "zip"
  output_path = "${path.module}/lambda.zip"

  source {
    content  = file("${path.module}/../../../case_scout/lambda/handler.py")
    filename = "handler.py"
  }

  dynamic "source" {
    for_each = fileset("${path.module}/../../../case_scout", "*.py")
    content {
      content  = file("${path.module}/../../../case_scout/${source.value}")
      filename = "case_scout/${source.value}"
    }
  }
}

resource "aws_lambda_function" "case_scout" {
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
  function_name    = "case-scout-${var.environment}"
  role             = aws_iam_role.lambda.arn
  handler          = "handler.handler"
  runtime          = "python3.13"

  # One `publish` does the GitHub commit/PR calls, the stale-PR sweep, the
  # Slack post, the gate-health ledger reads and the self-check's own GitHub
  # GET per open case-scout PR. gp-api's invoke
  # (caseScoutPublisher.service.ts) waits 310s, above this, so it never times
  # out and retries a `publish` that is still running — a retry would start a
  # second, concurrent publish for the same runId (duplicate Slack notes, a
  # possible PR-open race), not just re-read a slow response.
  timeout     = 300
  memory_size = 256

  environment {
    variables = {
      ENVIRONMENT                 = var.environment
      CASE_SCOUT_BUCKET           = aws_s3_bucket.scout.bucket
      AI_SECRETS_NAME             = "AI_SECRETS_${upper(var.environment)}"
      GITHUB_APP_ID               = var.github_app_id
      GITHUB_APP_INSTALLATION_ID  = var.github_app_installation_id
      CASE_SCOUT_SLACK_CHANNEL    = var.slack_channel
      CASE_SCOUT_ALERTS_TOPIC_ARN = aws_sns_topic.failures.arn
    }
  }

  depends_on = [aws_cloudwatch_log_group.lambda]

  tags = {
    Environment = var.environment
    Service     = "case-scout"
  }
}

# An async invoke must never auto-retry a publish that may still be running
# (see the timeout above). gp-api invokes synchronously, so this only
# guards a hand-run async invoke.
resource "aws_lambda_function_event_invoke_config" "case_scout" {
  function_name          = aws_lambda_function.case_scout.function_name
  maximum_retry_attempts = 0
}

# `publish`'s run-failed/gate-health alerts (case_scout/alerts.py) publish to
# the SAME failures topic the infra-level alarms already use.
resource "aws_iam_role_policy" "lambda_sns_publish" {
  name = "scout-sns-publish"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["sns:Publish"]
        Resource = aws_sns_topic.failures.arn
      }
    ]
  })
}

resource "aws_cloudwatch_log_metric_filter" "lambda_errors" {
  name           = "case-scout-lambda-errors-${var.environment}"
  log_group_name = aws_cloudwatch_log_group.lambda.name
  pattern        = "?\"ERROR\" ?\"Task timed out\""

  metric_transformation {
    name          = "LambdaErrors"
    namespace     = "CaseScout/${var.environment}"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_sns_topic" "failures" {
  name = "case-scout-failures-${var.environment}"

  tags = {
    Name        = "Case Scout Failures"
    Environment = var.environment
    Service     = "case-scout"
  }
}

resource "aws_sns_topic_policy" "failures" {
  arn = aws_sns_topic.failures.arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudWatchAlarms"
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

resource "aws_sns_topic_subscription" "failures_email" {
  count     = var.failure_notification_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.failures.arn
  protocol  = "email"
  endpoint  = var.failure_notification_email
}

# Reuses autopilot's shared Slack notifier (TDD: "Slack notifier reuse ...
# for the alert cases this story needs: claim failures, infra errors") —
# the same SNS-subscribed shared Lambda every other gp-ai module wires for
# infra alarms (see infrastructure/modules/alert-filter and
# autopilot-agent-fargate).
resource "aws_sns_topic_subscription" "shared_slack_notifier" {
  count     = var.shared_slack_notifier_lambda_arn != "" ? 1 : 0
  topic_arn = aws_sns_topic.failures.arn
  protocol  = "lambda"
  endpoint  = var.shared_slack_notifier_lambda_arn
}

resource "aws_lambda_permission" "allow_sns_invoke_slack" {
  count         = var.shared_slack_notifier_lambda_arn != "" ? 1 : 0
  statement_id  = "AllowSNSInvokeFromCaseScoutFailures-${var.environment}"
  action        = "lambda:InvokeFunction"
  function_name = var.shared_slack_notifier_lambda_arn
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.failures.arn
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  alarm_name          = "case-scout-lambda-errors-${var.environment}"
  alarm_description   = "case-scout ${var.environment} Lambda logged errors (a failed publish, an infra error, or a hard timeout). Check /aws/lambda/case-scout-${var.environment}."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "LambdaErrors"
  namespace           = "CaseScout/${var.environment}"
  period              = 300
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.failures.arn]
  ok_actions          = [aws_sns_topic.failures.arn]

  tags = {
    Environment = var.environment
    Service     = "case-scout"
  }
}
