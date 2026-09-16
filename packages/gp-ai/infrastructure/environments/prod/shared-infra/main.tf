terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket = "goodparty-terraform-state-us-west-2"
    key    = "shared-infra/prod/terraform.tfstate"
    region = "us-west-2"

    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project = "ai-projects"
    }
  }
}

data "aws_secretsmanager_secret_version" "ai_secrets" {
  secret_id = "AI_SECRETS_${upper(var.environment)}"
}

locals {
  ai_secrets = jsondecode(data.aws_secretsmanager_secret_version.ai_secrets.secret_string)
  api_key    = local.ai_secrets["SERVE_API_KEY"]
}

module "alb" {
  source = "../../../modules/alb"

  environment       = var.environment
  vpc_id            = var.vpc_id
  public_subnet_ids = var.public_subnet_ids
  certificate_arn   = var.certificate_arn
  api_key           = local.api_key
}

module "route53" {
  source = "../../../modules/route53"

  custom_domain_name = var.custom_domain_name
  route53_zone_id   = var.route53_zone_id
  alb_dns_name      = module.alb.alb_dns_name
  alb_zone_id       = module.alb.alb_zone_id
}

data "terraform_remote_state" "ddhq_matcher" {
  backend = "s3"

  config = {
    bucket = "goodparty-terraform-state-us-west-2"
    key    = "ddhq-matcher-fargate/prod/terraform.tfstate"
    region = "us-west-2"
  }
}

resource "aws_lb_target_group" "ddhq_matcher" {
  name        = "ddhq-matcher-${var.environment}"
  target_type = "lambda"

  tags = {
    Name        = "ddhq-matcher-${var.environment}"
    Environment = var.environment
    Purpose     = "DDHQ Matcher Lambda Target Group"
  }
}

resource "aws_lb_target_group_attachment" "ddhq_matcher" {
  target_group_arn = aws_lb_target_group.ddhq_matcher.arn
  target_id        = data.terraform_remote_state.ddhq_matcher.outputs.lambda_function_arn
  depends_on       = [aws_lambda_permission.ddhq_matcher_alb_invoke]
}

resource "aws_lambda_permission" "ddhq_matcher_alb_invoke" {
  statement_id  = "AllowExecutionFromALB"
  action        = "lambda:InvokeFunction"
  function_name = data.terraform_remote_state.ddhq_matcher.outputs.lambda_function_name
  principal     = "elasticloadbalancing.amazonaws.com"
  source_arn    = aws_lb_target_group.ddhq_matcher.arn
}

resource "aws_lb_listener_rule" "ddhq_matcher_valid" {
  listener_arn = module.alb.https_listener_arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.ddhq_matcher.arn
  }

  condition {
    path_pattern {
      values = ["/match/hubspot-ddhq"]
    }
  }

  condition {
    http_header {
      http_header_name = "x-api-key"
      values          = [local.api_key]
    }
  }

  tags = {
    Name        = "ddhq-matcher-valid-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_lb_listener_rule" "ddhq_matcher_invalid" {
  listener_arn = module.alb.https_listener_arn
  priority     = 15

  action {
    type = "fixed-response"

    fixed_response {
      content_type = "application/json"
      message_body = jsonencode({
        error = "Forbidden"
        message = "Invalid or missing API key"
      })
      status_code = "403"
    }
  }

  condition {
    path_pattern {
      values = ["/match/hubspot-ddhq"]
    }
  }

  tags = {
    Name        = "ddhq-matcher-invalid-${var.environment}"
    Environment = var.environment
  }
}

data "terraform_remote_state" "clickup_bot" {
  backend = "s3"

  config = {
    bucket = "goodparty-terraform-state-us-west-2"
    key    = "clickup-bot/prod/terraform.tfstate"
    region = "us-west-2"
  }
}

resource "aws_lb_target_group" "clickup_bot" {
  name        = "clickup-bot-${var.environment}"
  target_type = "lambda"

  tags = {
    Name        = "clickup-bot-${var.environment}"
    Environment = var.environment
    Purpose     = "ClickUp Webhook Handler"
  }
}

resource "aws_lb_target_group_attachment" "clickup_bot" {
  target_group_arn = aws_lb_target_group.clickup_bot.arn
  target_id        = data.terraform_remote_state.clickup_bot.outputs.lambda_function_arn
  depends_on       = [aws_lambda_permission.clickup_bot_alb_invoke]
}

resource "aws_lambda_permission" "clickup_bot_alb_invoke" {
  statement_id  = "AllowExecutionFromALB"
  action        = "lambda:InvokeFunction"
  function_name = data.terraform_remote_state.clickup_bot.outputs.lambda_function_name
  principal     = "elasticloadbalancing.amazonaws.com"
  source_arn    = aws_lb_target_group.clickup_bot.arn
}

resource "aws_lb_listener_rule" "clickup_bot" {
  listener_arn = module.alb.https_listener_arn
  priority     = 20

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.clickup_bot.arn
  }

  condition {
    path_pattern {
      values = ["/clickup/webhook"]
    }
  }

  tags = {
    Name        = "clickup-bot-${var.environment}"
    Environment = var.environment
  }
}

data "terraform_remote_state" "alert_filter" {
  backend = "s3"

  config = {
    bucket = "goodparty-terraform-state-us-west-2"
    key    = "alert-filter/prod/terraform.tfstate"
    region = "us-west-2"
  }
}

resource "aws_lb_target_group" "alert_filter" {
  name        = "alert-filter-${var.environment}"
  target_type = "lambda"

  tags = {
    Name        = "alert-filter-${var.environment}"
    Environment = var.environment
    Purpose     = "Grafana Alert Filter Webhook"
  }
}

resource "aws_lb_target_group_attachment" "alert_filter" {
  target_group_arn = aws_lb_target_group.alert_filter.arn
  target_id        = data.terraform_remote_state.alert_filter.outputs.lambda_function_arn
  depends_on       = [aws_lambda_permission.alert_filter_alb_invoke]
}

resource "aws_lambda_permission" "alert_filter_alb_invoke" {
  statement_id  = "AllowExecutionFromALB"
  action        = "lambda:InvokeFunction"
  function_name = data.terraform_remote_state.alert_filter.outputs.lambda_function_name
  principal     = "elasticloadbalancing.amazonaws.com"
  source_arn    = aws_lb_target_group.alert_filter.arn
}

# NO `x-api-key` CONDITION, unlike the ddhq-matcher rules above, and the
# difference is worth stating because the omission looks like one.
#
# Grafana's webhook contact point cannot send an arbitrary header alongside
# basic auth without a custom notifier, so a header condition here would mean
# either giving up basic auth or maintaining a notifier template. The
# authentication instead happens inside the function, which compares the basic
# auth password with `hmac.compare_digest` and answers 401 before reading a
# single byte of the body — and, deliberately, before fetching any secret, so an
# open endpoint cannot be used to run up a Secrets Manager bill.
#
# The trade is that an unauthenticated request costs one Lambda invocation
# rather than being rejected at the load balancer. That is a real cost and it is
# the cheaper side of the trade: an ALB fixed-response arm keyed on a header
# Grafana cannot send would reject Grafana too.
resource "aws_lb_listener_rule" "alert_filter" {
  listener_arn = module.alb.https_listener_arn
  priority     = 25

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.alert_filter.arn
  }

  condition {
    path_pattern {
      values = ["/grafana/alert-webhook"]
    }
  }

  tags = {
    Name        = "alert-filter-${var.environment}"
    Environment = var.environment
  }
}