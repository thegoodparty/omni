output "bucket_name" {
  value       = aws_s3_bucket.scout.bucket
  description = "The scout's S3 bucket name"
}

output "bucket_arn" {
  value       = aws_s3_bucket.scout.arn
  description = "The scout's S3 bucket ARN"
}

output "lambda_function_arn" {
  value       = aws_lambda_function.case_scout.arn
  description = "Lambda function ARN"
}

output "lambda_function_name" {
  value       = aws_lambda_function.case_scout.function_name
  description = "Lambda function name"
}

output "reader_cluster_arn" {
  value       = aws_ecs_cluster.reader.arn
  description = "ECS cluster ARN the Reader runs in"
}

output "reader_task_definition_arn" {
  value       = aws_ecs_task_definition.reader.arn
  description = "Reader ECS task definition ARN"
}

output "reader_task_definition_family" {
  value       = aws_ecs_task_definition.reader.family
  description = "Reader ECS task definition family"
}

output "reader_security_group_id" {
  value       = aws_security_group.reader_tasks.id
  description = "Security group ID for the Reader's ECS tasks"
}

output "reader_task_role_arn" {
  value       = aws_iam_role.reader_task.arn
  description = "Reader task role ARN"
}

output "reader_task_execution_role_arn" {
  value       = aws_iam_role.reader_task_execution.arn
  description = "Reader task execution role ARN"
}

output "failure_sns_topic_arn" {
  value       = aws_sns_topic.failures.arn
  description = "SNS topic that receives case scout failure alarms"
}
