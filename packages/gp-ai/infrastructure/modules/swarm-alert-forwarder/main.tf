variable "environment" {
  description = "Environment name. The forwarder reads SWARM_ALERT_WEBHOOK_URL and SWARM_ALERT_WEBHOOK_SECRET, which exist in AI_SECRETS_PROD only, so only prod roots instantiate this module."
  type        = string

  validation {
    condition     = var.environment == "prod"
    error_message = "The swarm alert forwarder signs with SWARM_ALERT_WEBHOOK_SECRET, which exists only in AI_SECRETS_PROD."
  }
}

variable "consumer" {
  description = "The service whose failure topic this instance forwards, e.g. serve-analyze. One instance per consumer keeps each root self-contained, so no root reads another's state to find the function it subscribes."
  type        = string
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

resource "aws_iam_role" "forwarder" {
  name = "swarm-alert-forwarder-${var.consumer}-${var.environment}"

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
  }
}

resource "aws_iam_role_policy_attachment" "forwarder_basic" {
  role       = aws_iam_role.forwarder.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "forwarder_secrets_access" {
  name = "secrets-manager-access"
  role = aws_iam_role.forwarder.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = "arn:aws:secretsmanager:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:secret:AI_SECRETS_${upper(var.environment)}-*"
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "forwarder" {
  name              = "/aws/lambda/swarm-alert-forwarder-${var.consumer}-${var.environment}"
  retention_in_days = 30

  tags = {
    Environment = var.environment
  }
}

resource "aws_lambda_function" "forwarder" {
  filename         = "${path.module}/lambda/swarm-alert-forwarder.zip"
  source_code_hash = filebase64sha256("${path.module}/lambda/swarm-alert-forwarder.zip")
  function_name    = "swarm-alert-forwarder-${var.consumer}-${var.environment}"
  role             = aws_iam_role.forwarder.arn
  handler          = "index.handler"
  runtime          = "nodejs24.x"
  timeout          = 30

  environment {
    variables = {
      SECRET_NAME   = "AI_SECRETS_${upper(var.environment)}"
      SECRET_REGION = data.aws_region.current.region
      ENVIRONMENT   = var.environment
    }
  }

  depends_on = [aws_cloudwatch_log_group.forwarder]

  tags = {
    Environment = var.environment
  }
}

output "lambda_function_arn" {
  value       = aws_lambda_function.forwarder.arn
  description = "ARN of the Lambda that forwards this consumer's failure topic to the swarm webhook"
}

output "lambda_function_name" {
  value       = aws_lambda_function.forwarder.function_name
  description = "Name of the Lambda that forwards this consumer's failure topic to the swarm webhook"
}
