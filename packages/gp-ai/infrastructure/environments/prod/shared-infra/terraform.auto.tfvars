# Non-secret AWS resource identifiers, committed so CI can plan and apply without
# hand-created files. Values verified against deployed state on 2026-08-05.
# SERVE_API_KEY is NOT here — shared-infra reads it from AI_SECRETS_<ENV> in
# Secrets Manager at plan time. Keep it that way.
environment        = "prod"
aws_region         = "us-west-2"
custom_domain_name = "ai.goodparty.org"
vpc_id             = "vpc-0763fa52c32ebcf6a"
public_subnet_ids  = ["subnet-07984b965dabfdedc", "subnet-01c540e6428cdd8db"]
certificate_arn    = "arn:aws:acm:us-west-2:333022194791:certificate/877b533e-4a54-4a63-8ed4-55818f0d8d34"
route53_zone_id    = "Z10392302OXMPNQLPO07K"
