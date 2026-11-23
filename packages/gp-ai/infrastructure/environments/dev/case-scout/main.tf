terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  backend "s3" {
    bucket       = "goodparty-terraform-state-us-west-2"
    key          = "case-scout/dev/terraform.tfstate"
    region       = "us-west-2"
    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  region = "us-west-2"

  default_tags {
    tags = {
      Project = "case-scout"
    }
  }
}

module "case_scout" {
  source = "../../../modules/case-scout"

  environment = "dev"
}

output "bucket_name" {
  value       = module.case_scout.bucket_name
  description = "S3 bucket the scout's gp-api jobs read and write"
}

# The Python reader's resources, dropped from the module when the reader moved
# into gp-api. Forgotten rather than destroyed: the release train refuses any
# plan that deletes (scripts/ci-apply-root.sh), and these sit idle and cost
# nothing, so they stay in AWS until someone deletes them by hand.
removed {
  from = module.case_scout.aws_iam_role_policy.lambda_ecs_run_task
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.case_scout.aws_cloudwatch_log_group.reader
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.case_scout.aws_iam_role.reader_task_execution
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.case_scout.aws_iam_role_policy_attachment.reader_task_execution
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.case_scout.aws_iam_role_policy.reader_task_execution_secrets
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.case_scout.aws_iam_role.reader_task
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.case_scout.aws_iam_role_policy.reader_task_bucket
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.case_scout.aws_iam_role_policy.reader_task_judge_records_readonly
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.case_scout.aws_iam_role_policy.reader_task_secrets
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.case_scout.aws_iam_role_policy.reader_task_invoke_publish
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.case_scout.aws_iam_role_policy.reader_task_sns_publish
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.case_scout.aws_iam_role_policy.reader_task_cloudwatch_logs
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.case_scout.aws_security_group.reader_tasks
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.case_scout.aws_ecs_cluster.reader
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.case_scout.aws_ecs_task_definition.reader
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.case_scout.aws_cloudwatch_event_rule.reader_task_failed
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.case_scout.aws_cloudwatch_event_target.reader_task_failed_to_sns
  lifecycle {
    destroy = false
  }
}

# The publisher Lambda and its alarms, dropped from the module when gp-api
# began handing each night to the Delegate swarm. Forgotten rather than
# destroyed, for the same reason as the reader's above.

removed {
  from = module.case_scout.aws_lambda_function.case_scout
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.case_scout.aws_lambda_function_event_invoke_config.case_scout
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.case_scout.aws_cloudwatch_log_group.lambda
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.case_scout.aws_iam_role.lambda
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.case_scout.aws_iam_role_policy_attachment.lambda_basic
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.case_scout.aws_iam_role_policy.lambda_bucket
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.case_scout.aws_iam_role_policy.lambda_secrets
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.case_scout.aws_iam_role_policy.lambda_sns_publish
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.case_scout.aws_cloudwatch_log_metric_filter.lambda_errors
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.case_scout.aws_cloudwatch_metric_alarm.lambda_errors
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.case_scout.aws_sns_topic.failures
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.case_scout.aws_sns_topic_policy.failures
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.case_scout.aws_sns_topic_subscription.failures_email
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.case_scout.aws_sns_topic_subscription.shared_slack_notifier
  lifecycle {
    destroy = false
  }
}

removed {
  from = module.case_scout.aws_lambda_permission.allow_sns_invoke_slack
  lifecycle {
    destroy = false
  }
}
