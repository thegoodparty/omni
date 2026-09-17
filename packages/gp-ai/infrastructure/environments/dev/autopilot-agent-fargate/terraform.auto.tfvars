# Non-secret AWS resource identifiers, committed so CI can plan and apply without
# hand-created files. Same VPC/subnets as every other dev gp-ai Fargate root
# (e.g. engineer-agent-fargate).
vpc_id             = "vpc-0763fa52c32ebcf6a"
private_subnet_ids = ["subnet-053357b931f0524d4", "subnet-0bb591861f72dcb7f"]
# No failure_notification_email: this root has no email subscription
# deployed, and setting it would make the plan create one.
