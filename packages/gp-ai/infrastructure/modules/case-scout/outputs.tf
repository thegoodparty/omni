output "bucket_name" {
  value       = aws_s3_bucket.scout.bucket
  description = "The scout's S3 bucket name"
}

output "bucket_arn" {
  value       = aws_s3_bucket.scout.arn
  description = "The scout's S3 bucket ARN"
}
