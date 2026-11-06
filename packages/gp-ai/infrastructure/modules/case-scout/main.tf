# The case scout's AWS infrastructure: its bucket, its Lambda (the `start`
# and `publish` entry points), and the Reader's Fargate task definition +
# IAM role. This story (the service scaffold) wires all three so later
# stories import one client / fill in one task role rather than inventing
# their own — see packages/gp-ai/case_scout/AGENTS.md-equivalent context in
# the TDD's "New infra" section ("One gp-ai member ... one bucket ... Two
# workflows").
#
# NOT YET WIRED: no environment root under infrastructure/environments/
# references this module yet, and case-scout-nightly.yml's schedule will
# fail "function not found" until one does. That lands with the end-to-end
# wiring story (TDD M1's last story), which is also what first builds a real
# Reader image for docker_image_tag to point at. Until then, `terraform
# plan` against this module (with throwaway variable values) is how its
# correctness is checked — see case_scout/tests/test_packaging.py for the
# Lambda zip's own coverage check.

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

# --- Bucket ------------------------------------------------------------
#
# "One bucket, whose create-only-if-missing writes replace a database table"
# (TDD, "New infra"). Terraform owns its existence and settings; the scout's
# own code treats every key under it as create-only (marker.json's If-Match,
# claims/<runDate>'s If-None-Match) — see case_scout/bucket.py. No lifecycle
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

# --- Lambda: `start` and `publish` --------------------------------------

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

# claims/<runDate> (start) and the Publisher's eventual bundle/marker reads
# (publish) — scoped to this bucket alone, nothing else in the account.
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
# Lambda reads (github_auth.py's GITHUB_APP_PRIVATE_KEY lives here) — never a
# grant on gp_api_pg, gp_api_pg_dev, or membership in gp_api_pg_readers. Those
# are Databricks Unity Catalog constructs with no AWS IAM equivalent at all;
# the scout's Databricks access is provisioned entirely in
# gp-terraform-dataplatform (TDD section 9), outside this account and outside
# this module. This policy's Resource is scoped to exactly one Secrets
# Manager ARN prefix, so there is nothing here for either grant to attach to.
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

  # `start` today only claims the night (one S3 conditional write) and
  # returns; `publish` only reads a bundle. Neither needs more than this —
  # revisit once `start` actually launches the Reader (ecs:RunTask's own
  # dispatch latency) in a later story.
  timeout     = 60
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
      # `start`'s Reader dispatch (case_scout/dispatch.py) — the Lambda zip
      # ships no business logic to read these from Terraform outputs at
      # runtime, so they're passed as plain env vars, same shape as
      # autopilot-agent-fargate's Lambda (ECS_CLUSTER_ARN/ECS_TASK_DEFINITION/
      # SUBNET_IDS/SECURITY_GROUP_ID).
      ECS_CLUSTER_ARN     = aws_ecs_cluster.reader.arn
      ECS_TASK_DEFINITION = aws_ecs_task_definition.reader.family
      SUBNET_IDS          = join(",", var.private_subnet_ids)
      SECURITY_GROUP_ID   = aws_security_group.reader_tasks.id
    }
  }

  depends_on = [aws_cloudwatch_log_group.lambda]

  tags = {
    Environment = var.environment
    Service     = "case-scout"
  }
}

# A crashed/timed-out `start` must never auto-retry: a retry after an
# ambiguous S3 PutObject failure (claimed server-side, failed to confirm)
# risks claiming the SAME night twice in a way that could race a Reader
# dispatch once one exists. The claim's own If-None-Match already makes a
# clean retry a no-op; this just stops the platform from attempting one.
resource "aws_lambda_function_event_invoke_config" "case_scout" {
  function_name          = aws_lambda_function.case_scout.function_name
  maximum_retry_attempts = 0
}

# S9 (end-to-end wiring): `start` launches the Reader's Fargate task itself
# (case_scout/dispatch.py) — the grant infrastructure/modules/case-scout's
# own "Nothing calls RunTask against this task definition yet" comment said
# would land with the Reader stories.
resource "aws_iam_role_policy" "lambda_ecs_run_task" {
  name = "scout-ecs-run-task"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecs:RunTask"]
        Resource = aws_ecs_task_definition.reader.arn
      },
      {
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = [aws_iam_role.reader_task.arn, aws_iam_role.reader_task_execution.arn]
      }
    ]
  })
}

# `start`'s "no run in 36 hours" check and `publish`'s run-failed/gate-health
# alerts (case_scout/alerts.py, case_scout/health.py) publish to the SAME
# failures topic the infra-level alarms already use.
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
        Effect    = "Allow"
        Principal = { Service = "cloudwatch.amazonaws.com" }
        Action    = "SNS:Publish"
        Resource  = aws_sns_topic.failures.arn
        Condition = {
          StringEquals = { "AWS:SourceAccount" = data.aws_caller_identity.current.account_id }
        }
      },
      {
        Effect    = "Allow"
        Principal = { Service = "events.amazonaws.com" }
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
# autopilot-agent-fargate). Real alert CONTENT (what a claim failure means,
# what to do about it) arrives with the Reader/Publisher stories; this is
# the plumbing those stories post through.
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
  alarm_description   = "case-scout ${var.environment} Lambda logged errors (a claim failure, an infra error, or a hard timeout). Check /aws/lambda/case-scout-${var.environment}."
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

# --- Reader: Fargate task definition + IAM role -------------------------
#
# Task definition and role only — the Reader's own pipeline (reading the
# Databricks view, scoring, drafting, gating) is later stories. Modeled on
# autopilot-agent-fargate's task-definition/IAM shape, with the Reader's own
# cluster (own-cluster isolation, same reasoning as that module's header
# comment) and its own least-privilege role.

resource "aws_cloudwatch_log_group" "reader" {
  name              = "/ecs/case-scout-reader-${var.environment}"
  retention_in_days = 400

  tags = {
    Environment = var.environment
    Service     = "case-scout"
  }
}

resource "aws_iam_role" "reader_task_execution" {
  name = "case-scout-reader-task-execution-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action    = "sts:AssumeRole"
        Effect    = "Allow"
        Principal = { Service = "ecs-tasks.amazonaws.com" }
      }
    ]
  })

  tags = {
    Environment = var.environment
    Service     = "case-scout"
  }
}

resource "aws_iam_role_policy_attachment" "reader_task_execution" {
  role       = aws_iam_role.reader_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "reader_task_execution_secrets" {
  name = "secrets-manager-access"
  role = aws_iam_role.reader_task_execution.id

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

# THE LEAST-PRIVILEGE GRANT (TDD Implementation Notes 1.9 / this story's
# acceptance criteria): this role gets the scout's own bucket and the shared
# AI_SECRETS_<ENV> bundle (the same Anthropic key and, once the secrets PR
# lands, the scout's own Databricks OAuth credential) — and NOTHING else.
# Explicitly, this role is never granted on gp_api_pg or gp_api_pg_dev, and
# is never added to gp_api_pg_readers: neither is an AWS resource this
# account's IAM can reach, and the scout's Databricks access is provisioned
# entirely in gp-terraform-dataplatform against its own service principal
# (sp_case_scout), outside this module and outside this account.
resource "aws_iam_role" "reader_task" {
  name = "case-scout-reader-task-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action    = "sts:AssumeRole"
        Effect    = "Allow"
        Principal = { Service = "ecs-tasks.amazonaws.com" }
      }
    ]
  })

  tags = {
    Environment = var.environment
    Service     = "case-scout"
  }
}

resource "aws_iam_role_policy" "reader_task_bucket" {
  name = "scout-bucket-access"
  role = aws_iam_role.reader_task.id

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

resource "aws_iam_role_policy" "reader_task_secrets" {
  name = "secrets-manager-access"
  role = aws_iam_role.reader_task.id

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

# S9: reader/main.py's _invoke_publish hands off to the Lambda's `publish`
# action once the night's bucket objects are written (the TDD's
# three-process split: this task never holds the GitHub key itself).
resource "aws_iam_role_policy" "reader_task_invoke_publish" {
  name = "scout-invoke-publish"
  role = aws_iam_role.reader_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = aws_lambda_function.case_scout.arn
      }
    ]
  })
}

# S9: reader/main.py alerts through case_scout/alerts.py on a spend-cap hit,
# same failures topic the Lambda-side and infra-level alarms already use.
resource "aws_iam_role_policy" "reader_task_sns_publish" {
  name = "scout-sns-publish"
  role = aws_iam_role.reader_task.id

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

resource "aws_iam_role_policy" "reader_task_cloudwatch_logs" {
  name = "cloudwatch-logs-access"
  role = aws_iam_role.reader_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:DescribeLogGroups",
          "logs:DescribeLogStreams",
          "logs:GetLogEvents",
          "logs:FilterLogEvents"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_security_group" "reader_tasks" {
  name        = "case-scout-reader-ecs-tasks-${var.environment}"
  description = "Security group for the case scout Reader's ECS tasks"
  vpc_id      = var.vpc_id

  egress {
    description = "HTTPS for APIs (Anthropic, Databricks, AWS)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "DNS resolution"
    from_port   = 53
    to_port     = 53
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "Case Scout Reader ECS Tasks"
    Environment = var.environment
  }
}

resource "aws_ecs_cluster" "reader" {
  name = "case-scout-reader-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Environment = var.environment
  }
}

# RunTask-only, no aws_ecs_service: the Reader runs once a night and stops,
# same reasoning as autopilot-agent-fargate's identical comment. Nothing
# calls RunTask against this task definition yet (the `start` Lambda handler
# is a stub — see case_scout/lambda/handler.py) — that dispatch, and the IAM
# grant it needs on the LAMBDA's role, lands with the Reader stories.
resource "aws_ecs_task_definition" "reader" {
  family                   = "case-scout-reader-${var.environment}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.reader_task_execution.arn
  task_role_arn            = aws_iam_role.reader_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([
    {
      name  = "case-scout-reader"
      image = "${var.ecr_repository_url}:${var.docker_image_tag}"

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.reader.name
          "awslogs-region"        = data.aws_region.current.region
          "awslogs-stream-prefix" = "ecs"
        }
      }

      secrets = [
        {
          name      = "ANTHROPIC_API_KEY"
          valueFrom = "arn:aws:secretsmanager:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:secret:AI_SECRETS_${upper(var.environment)}:ANTHROPIC_API_KEY::"
        }
      ]

      environment = [
        {
          name  = "ENVIRONMENT"
          value = var.environment
        },
        {
          name  = "CASE_SCOUT_BUCKET"
          value = aws_s3_bucket.scout.bucket
        },
        {
          name  = "CASE_SCOUT_LAMBDA_FUNCTION_NAME"
          value = aws_lambda_function.case_scout.function_name
        },
        {
          name  = "CASE_SCOUT_ALERTS_TOPIC_ARN"
          value = aws_sns_topic.failures.arn
        },
        {
          name  = "CASE_SCOUT_SPEND_CAP_USD"
          value = var.spend_cap_usd
        }
      ]
    }
  ])

  tags = {
    Environment = var.environment
  }
}

resource "aws_cloudwatch_event_rule" "reader_task_failed" {
  name        = "case-scout-reader-task-failed-${var.environment}"
  description = "Capture ECS task failures for the case scout Reader"

  event_pattern = jsonencode({
    source      = ["aws.ecs"]
    detail-type = ["ECS Task State Change"]
    detail = {
      clusterArn = [aws_ecs_cluster.reader.arn]
      lastStatus = ["STOPPED"]
      containers = {
        exitCode = [{
          "anything-but" = 0
        }]
      }
    }
  })

  tags = {
    Environment = var.environment
  }
}

resource "aws_cloudwatch_event_target" "reader_task_failed_to_sns" {
  rule      = aws_cloudwatch_event_rule.reader_task_failed.name
  target_id = "SendToSNS"
  arn       = aws_sns_topic.failures.arn

  input_transformer {
    input_paths = {
      taskArn       = "$.detail.taskArn"
      stoppedReason = "$.detail.stoppedReason"
      exitCode      = "$.detail.containers[0].exitCode"
      clusterArn    = "$.detail.clusterArn"
      time          = "$.time"
    }

    input_template = <<EOF
{
  "alarm": "case scout Reader task failed",
  "environment": "${var.environment}",
  "cluster": <clusterArn>,
  "taskArn": <taskArn>,
  "stoppedReason": <stoppedReason>,
  "exitCode": <exitCode>,
  "time": <time>,
  "logs": "https://console.aws.amazon.com/cloudwatch/home?region=${data.aws_region.current.region}#logsV2:log-groups/log-group/$252Fecs$252Fcase-scout-reader-${var.environment}"
}
EOF
  }
}
