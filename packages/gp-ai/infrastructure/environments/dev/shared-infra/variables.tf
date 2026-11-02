variable "environment" {
  description = "Environment name"
  type        = string
  default     = "dev"
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-west-2"
}

variable "custom_domain_name" {
  description = "Custom domain name"
  type        = string
  default     = "ai-dev.goodparty.org"
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnet IDs"
  type        = list(string)
}

variable "certificate_arn" {
  description = "ACM certificate ARN"
  type        = string
}

variable "route53_zone_id" {
  description = "Route53 hosted zone ID"
  type        = string
}

# A variable rather than a data source on AI_SECRETS_<ENV>. The listener rules
# need the value itself, and a data source would make every plan read the whole
# blob and write it to state. The CI scripts supply it: ci-apply-root.sh from
# Secrets Manager, ci-plan-root.sh from the value this root's rules already hold.
variable "serve_api_key" {
  description = "SERVE_API_KEY from AI_SECRETS_<ENV>, matched against the x-api-key header by the ALB listener rules."
  type        = string
  sensitive   = true
}
