# Copied from modules/engineer-agent-fargate rather than extending it
# (isolation decision — see the TDD): autopilot is a separate stage-runner with
# its own task family, its own secret set, and a second, Playwright-installed
# image variant that engineer-agent has no equivalent of. Its own cluster, same
# as engineer-agent's own-cluster pattern, so a RunTask failure or IAM change
# on one bot can never touch the other's tasks.
#
# RunTask-only, no aws_ecs_service: a service keeps the last task definition
# running and restart-loops it on failure, which is wrong for a stage runner
# that is meant to run once per invocation and stop. The autopilot-bot
# conductor (a separate root) calls RunTask directly against the task
# definitions this module outputs.
#
# Both task definitions stay ARM64: Playwright chromium was verified locally
# (ENG-11096) to install and launch fine on linux/arm64, so the qa variant
# needs no x86_64 fallback.

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

resource "aws_cloudwatch_log_group" "agent" {
  name = "/ecs/autopilot-agent-${var.environment}"

  # 400 days, mirroring engineer-agent-fargate: this log group is the durable
  # record of what each stage run did and what it cost, and reporting on it is
  # annual-ish and comparative — a short retention would delete the evidence
  # faster than anyone could report on a quarter of it.
  retention_in_days = 400

  tags = {
    Environment = var.environment
  }
}

resource "aws_iam_role" "task_execution_role" {
  name = "autopilot-agent-task-execution-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "task_execution_role_policy" {
  role       = aws_iam_role.task_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "task_execution_secrets_access" {
  name = "secrets-manager-access"
  role = aws_iam_role.task_execution_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:AI_SECRETS_${upper(var.environment)}-*"
      }
    ]
  })
}

# Task role minimal (logs only), matching engineer-agent: the agent's actual
# work (ClickUp, GitHub, Slack, Amplitude) authenticates with the API keys
# injected as container secrets below, not with AWS IAM.
resource "aws_iam_role" "task_role" {
  name = "autopilot-agent-task-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "task_cloudwatch_logs" {
  name = "cloudwatch-logs-access"
  role = aws_iam_role.task_role.id

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

resource "aws_security_group" "ecs_tasks" {
  name        = "autopilot-agent-ecs-tasks-${var.environment}"
  description = "Security group for Autopilot Agent ECS tasks"
  vpc_id      = var.vpc_id

  egress {
    description = "HTTPS for APIs (Anthropic, ClickUp, GitHub, Slack, Amplitude)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "SSH for git clone operations"
    from_port   = 22
    to_port     = 22
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
    Name        = "Autopilot Agent ECS Tasks"
    Environment = var.environment
  }
}

resource "aws_ecs_cluster" "agent" {
  name = "autopilot-agent-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Environment = var.environment
  }
}

# Secrets shared by both task definitions: neither variant differs in what it
# needs to authenticate against ClickUp/GitHub/Slack/Amplitude, and Claude
# Code itself reads ANTHROPIC_API_KEY. Per-key from AI_SECRETS_<ENV>, never as
# plain environment — see task_execution_secrets_access above for the read
# policy this relies on.
locals {
  agent_secrets = [
    {
      name      = "ANTHROPIC_API_KEY"
      valueFrom = "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:AI_SECRETS_${upper(var.environment)}:ANTHROPIC_API_KEY::"
    },
    {
      name      = "CLICKUP_API_KEY"
      valueFrom = "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:AI_SECRETS_${upper(var.environment)}:CLICKUP_API_KEY::"
    },
    {
      name      = "GITHUB_APP_PRIVATE_KEY"
      valueFrom = "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:AI_SECRETS_${upper(var.environment)}:GITHUB_APP_PRIVATE_KEY::"
    },
    {
      name      = "SLACK_BOT_TOKEN"
      valueFrom = "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:AI_SECRETS_${upper(var.environment)}:SLACK_BOT_TOKEN::"
    },
    {
      name      = "AMPLITUDE_MANAGEMENT_API_KEY"
      valueFrom = "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:AI_SECRETS_${upper(var.environment)}:AMPLITUDE_MANAGEMENT_API_KEY::"
    },
    {
      # Clerk machine secret (ak_...) for the "autopilot-qa" machine in the
      # DEV Clerk instance, scoped to the gp-api machine. The qa stage mints a
      # short-TTL mt_ token from it at run start (gp-api's
      # ElectionApiTokenService pattern — Clerk caps m2m token TTLs, so a
      # static long-lived token is not an option) to call the
      # AdminOrM2MGuard-protected test-fixtures API for QA users. Same
      # dev-instance value in both AWS envs: qa always verifies against the
      # dev deploy (test-fixtures 404s outside dev/preview), so prod rollout
      # changes nothing here.
      name      = "AUTOPILOT_MACHINE_SECRET"
      valueFrom = "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:AI_SECRETS_${upper(var.environment)}:AUTOPILOT_MACHINE_SECRET::"
    }
  ]

  agent_environment = [
    {
      name  = "ENVIRONMENT"
      value = var.environment
    },
    {
      name  = "WORKSPACE_DIR"
      value = "/workspace"
    },
    # "DEV"/"PROD" below are Amplitude projects, not this AWS environment:
    # autopilot's flag client (autopilot/agent/amplitude_flags.py) creates
    # every flag in BOTH Amplitude projects — on at 100% in the dev project,
    # 0% in prod — no matter which agent environment runs the stage, so both
    # AWS envs carry all four values. Not var.environment-dependent on
    # purpose. Ids resolved live from the Experiment management API on
    # 2026-09-17; they only change if someone adds or deletes a deployment in
    # the Amplitude UI (see .claude/skills/amplitude-flag/SKILL.md, which
    # documents the same layout for the human-driven flow).
    {
      name  = "AMPLITUDE_DEV_PROJECT_ID"
      value = "703396"
    },
    {
      name  = "AMPLITUDE_DEV_DEPLOYMENT_IDS"
      value = "13486"
    },
    {
      name  = "AMPLITUDE_PROD_PROJECT_ID"
      value = "694490"
    },
    {
      name  = "AMPLITUDE_PROD_DEPLOYMENT_IDS"
      value = "13485,53792"
    },
    # Where the qa stage's test-fixtures calls go. Deliberately the dev API in
    # both AWS envs, same as the Amplitude ids above: qa verifies stories on
    # the dev deploy, and the fixtures endpoints only exist there.
    {
      name  = "GP_API_DEV_BASE_URL"
      value = "https://gp-api-dev.goodparty.org"
    },
    # gp-api's tsc/vitest overflow Node's default heap — the same OOM CI hit
    # (release train fixed it with a 6GB NODE_OPTIONS); a live story run
    # burned dozens of its turns retrying "JavaScript heap out of memory"
    # verify commands before dying on the turn cap.
    {
      name  = "NODE_OPTIONS"
      value = "--max-old-space-size=6144"
    }
  ]
}

# Base image: epic-create/story/resume stages. No browsers baked in.
resource "aws_ecs_task_definition" "agent" {
  family                   = "autopilot-agent-${var.environment}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.task_execution_role.arn
  task_role_arn            = aws_iam_role.task_role.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  # Fargate's 20 GiB default is not enough for a story run: an omni clone
  # plus a worktree's npm ci, workspace builds, and Prisma engines overflowed
  # it live (ENOSPC ~37 minutes into the first Story 2 run, killing the run
  # mid-implementation with nothing parked on the card).
  ephemeral_storage {
    size_in_gib = 60
  }

  container_definitions = jsonencode([
    {
      name  = "autopilot-agent"
      image = "${var.ecr_repository_url}:${var.docker_image_tag}"

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.agent.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "ecs"
        }
      }

      secrets     = local.agent_secrets
      environment = local.agent_environment
    }
  ])

  tags = {
    Environment = var.environment
  }
}

# Playwright-installed image: the qa stage only. Same secrets/env, 2x memory
# (see variables.tf), separate family so a qa run and a story run never
# contend for the same task definition revision.
resource "aws_ecs_task_definition" "agent_playwright" {
  family                   = "autopilot-agent-playwright-${var.environment}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory_playwright
  execution_role_arn       = aws_iam_role.task_execution_role.arn
  task_role_arn            = aws_iam_role.task_role.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  # Same ENOSPC reasoning as the base task definition above; qa runs clone
  # the same repo and additionally carry the browser install.
  ephemeral_storage {
    size_in_gib = 60
  }

  container_definitions = jsonencode([
    {
      name  = "autopilot-agent-playwright"
      image = "${var.ecr_repository_url}:${var.docker_image_tag_playwright}"

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.agent.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "ecs"
        }
      }

      secrets     = local.agent_secrets
      environment = local.agent_environment
    }
  ])

  tags = {
    Environment = var.environment
  }
}

resource "aws_sns_topic" "agent_failures" {
  name = "autopilot-agent-failures-${var.environment}"

  tags = {
    Name        = "Autopilot Agent Failures"
    Environment = var.environment
  }
}

resource "aws_sns_topic_subscription" "agent_failures_email" {
  count     = var.failure_notification_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.agent_failures.arn
  protocol  = "email"
  endpoint  = var.failure_notification_email
}

# Scoped to the cluster, not to either task-definition family, so one rule
# catches a failed run of EITHER variant.
resource "aws_cloudwatch_event_rule" "ecs_task_failed" {
  name        = "autopilot-agent-task-failed-${var.environment}"
  description = "Capture ECS task failures for Autopilot Agent"

  event_pattern = jsonencode({
    source      = ["aws.ecs"]
    detail-type = ["ECS Task State Change"]
    detail = {
      clusterArn = [aws_ecs_cluster.agent.arn]
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

resource "aws_cloudwatch_event_target" "send_to_sns" {
  rule      = aws_cloudwatch_event_rule.ecs_task_failed.name
  target_id = "SendToSNS"
  arn       = aws_sns_topic.agent_failures.arn

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
  "alarm": "🔴 Autopilot Agent Task Failed",
  "environment": "${var.environment}",
  "cluster": <clusterArn>,
  "taskArn": <taskArn>,
  "stoppedReason": <stoppedReason>,
  "exitCode": <exitCode>,
  "time": <time>,
  "logs": "https://console.aws.amazon.com/cloudwatch/home?region=${data.aws_region.current.name}#logsV2:log-groups/log-group/$252Fecs$252Fautopilot-agent-${var.environment}"
}
EOF
  }
}

resource "aws_sns_topic_policy" "agent_failures" {
  arn = aws_sns_topic.agent_failures.arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "events.amazonaws.com"
        }
        Action   = "SNS:Publish"
        Resource = aws_sns_topic.agent_failures.arn
      }
    ]
  })
}

resource "aws_sns_topic_subscription" "shared_slack_notifier" {
  count     = var.shared_slack_notifier_lambda_arn != "" ? 1 : 0
  topic_arn = aws_sns_topic.agent_failures.arn
  protocol  = "lambda"
  endpoint  = var.shared_slack_notifier_lambda_arn
}

resource "aws_lambda_permission" "allow_sns_invoke_slack" {
  count = var.shared_slack_notifier_lambda_arn != "" ? 1 : 0
  # Statement ids are unique per function, and the engineer-agent module
  # already holds "AllowSNSInvokeFromAgentFailures" on this same shared
  # notifier lambda — reusing it fails the apply with ResourceConflictException.
  statement_id  = "AllowSNSInvokeFromAutopilotAgentFailures"
  action        = "lambda:InvokeFunction"
  function_name = var.shared_slack_notifier_lambda_arn
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.agent_failures.arn
}
