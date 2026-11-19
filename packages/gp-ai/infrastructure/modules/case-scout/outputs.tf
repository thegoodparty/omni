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

output "failure_sns_topic_arn" {
  value       = aws_sns_topic.failures.arn
  description = "SNS topic that receives case scout failure alarms"
}
