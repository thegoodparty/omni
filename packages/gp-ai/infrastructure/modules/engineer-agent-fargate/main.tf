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
  description = "Immutable, SHA-pinned image tag (e.g. broker-a1b2c3d). No default on purpose: CI always passes it, and a default silently ships the wrong image — these modules previously defaulted to *-prod tags, so a dev root that omitted the variable would have deployed the prod image."
  type        = string
}

variable "failure_notification_email" {
  description = "Email address to receive ECS task failure notifications"
  type        = string
  default     = ""
}

variable "escalate_analysis_to_work" {
  description = <<-EOT
    When true, an analyze run that ends with `GPBOT-VERDICT: fix` tags its own
    ClickUp ticket `gpbot-work`, which queues an implementation run and opens a
    PR with no human in between.

    Defaults to FALSE, and the default is the point: this changes what arrives in
    the repository unreviewed, so it must be switched on deliberately rather than
    inherited by deploying the code. With it off, the agent still logs the verdict
    it would have acted on ("escalation disabled"), which is how you judge whether
    the verdicts are trustworthy before handing them the trigger.

    Before enabling: vars.GPBOT_PR_CHANNEL_ID must be set (or bot PRs get a
    GitHub review request with no Slack context) and the team should know bot PRs
    are coming, that a bot approval does not merge them, and that closing a weak
    one is the expected outcome.
  EOT
  type        = bool
  default     = false
}

variable "shared_slack_notifier_lambda_arn" {
  description = "ARN of the shared Slack notifier Lambda function"
  type        = string
  default     = ""
}

variable "task_cpu" {
  description = "CPU units for ECS Fargate task"
  type        = string
  default     = "2048"
}

variable "task_memory" {
  description = "Memory for ECS Fargate task in MB"
  type        = string
  default     = "4096"
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

resource "aws_cloudwatch_log_group" "agent" {
  name              = "/ecs/engineer-agent-${var.environment}"
  retention_in_days = 30

  tags = {
    Environment = var.environment
  }
}

resource "aws_iam_role" "task_execution_role" {
  name = "engineer-agent-task-execution-${var.environment}"

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

resource "aws_iam_role" "task_role" {
  name = "engineer-agent-task-${var.environment}"

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
  name        = "engineer-agent-ecs-tasks-${var.environment}"
  description = "Security group for Engineer Agent ECS tasks"
  vpc_id      = var.vpc_id

  egress {
    description = "HTTPS for APIs (Anthropic, ClickUp, GitHub)"
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
    Name        = "Engineer Agent ECS Tasks"
    Environment = var.environment
  }
}

resource "aws_ecs_cluster" "agent" {
  name = "engineer-agent-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Environment = var.environment
  }
}

resource "aws_ecs_task_definition" "agent" {
  family                   = "engineer-agent-${var.environment}"
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

  container_definitions = jsonencode([
    {
      name  = "engineer-agent"
      image = "${var.ecr_repository_url}:${var.docker_image_tag}"

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.agent.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "ecs"
        }
      }

      secrets = [
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
          name      = "DATABRICKS_API_KEY"
          valueFrom = "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:AI_SECRETS_${upper(var.environment)}:DATABRICKS_API_KEY::"
        },
        {
          name      = "DATABRICKS_SERVER_HOSTNAME"
          valueFrom = "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:AI_SECRETS_${upper(var.environment)}:DATABRICKS_SERVER_HOSTNAME::"
        },
        {
          name      = "DATABRICKS_HTTP_PATH"
          valueFrom = "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:AI_SECRETS_${upper(var.environment)}:DATABRICKS_HTTP_PATH::"
        },
        {
          name      = "DATABRICKS_CATALOG"
          valueFrom = "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:AI_SECRETS_${upper(var.environment)}:DATABRICKS_CATALOG::"
        },
        {
          name      = "DATABRICKS_SCHEMA"
          valueFrom = "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:AI_SECRETS_${upper(var.environment)}:DATABRICKS_SCHEMA::"
        },
        {
          name      = "SLACK_BOT_TOKEN"
          valueFrom = "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:AI_SECRETS_${upper(var.environment)}:SLACK_BOT_TOKEN::"
        }
      ]

      environment = [
        {
          name  = "ENVIRONMENT"
          value = var.environment
        },
        {
          name  = "WORKSPACE_DIR"
          value = "/workspace"
        },
        {
          name  = "GPBOT_ESCALATE_TO_WORK"
          value = tostring(var.escalate_analysis_to_work)
        }
      ]
    }
  ])

  tags = {
    Environment = var.environment
  }
}

resource "aws_sns_topic" "agent_failures" {
  name = "engineer-agent-failures-${var.environment}"

  tags = {
    Name        = "Engineer Agent Failures"
    Environment = var.environment
  }
}

resource "aws_sns_topic_subscription" "agent_failures_email" {
  count     = var.failure_notification_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.agent_failures.arn
  protocol  = "email"
  endpoint  = var.failure_notification_email
}

resource "aws_cloudwatch_event_rule" "ecs_task_failed" {
  name        = "engineer-agent-task-failed-${var.environment}"
  description = "Capture ECS task failures for Engineer Agent"

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
  "alarm": "🔴 Engineer Agent Task Failed",
  "environment": "${var.environment}",
  "cluster": <clusterArn>,
  "taskArn": <taskArn>,
  "stoppedReason": <stoppedReason>,
  "exitCode": <exitCode>,
  "time": <time>,
  "logs": "https://console.aws.amazon.com/cloudwatch/home?region=${data.aws_region.current.name}#logsV2:log-groups/log-group/$252Fecs$252Fengineer-agent-${var.environment}"
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
  count         = var.shared_slack_notifier_lambda_arn != "" ? 1 : 0
  statement_id  = "AllowSNSInvokeFromAgentFailures"
  action        = "lambda:InvokeFunction"
  function_name = var.shared_slack_notifier_lambda_arn
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.agent_failures.arn
}

output "cluster_name" {
  value       = aws_ecs_cluster.agent.name
  description = "ECS cluster name"
}

output "cluster_arn" {
  value       = aws_ecs_cluster.agent.arn
  description = "ECS cluster ARN"
}

output "task_definition_arn" {
  value       = aws_ecs_task_definition.agent.arn
  description = "ECS task definition ARN"
}

output "task_definition_family" {
  value       = aws_ecs_task_definition.agent.family
  description = "ECS task definition family"
}

output "security_group_id" {
  value       = aws_security_group.ecs_tasks.id
  description = "Security group ID for ECS tasks"
}

output "task_execution_role_arn" {
  value       = aws_iam_role.task_execution_role.arn
  description = "Task execution role ARN"
}

output "task_role_arn" {
  value       = aws_iam_role.task_role.arn
  description = "Task role ARN"
}

output "sns_topic_arn" {
  value       = aws_sns_topic.agent_failures.arn
  description = "SNS topic for agent failure notifications"
}
