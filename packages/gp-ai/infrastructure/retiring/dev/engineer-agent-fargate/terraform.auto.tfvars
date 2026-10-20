# Non-secret AWS resource identifiers, committed so CI can plan and apply without
# hand-created files. Values verified against deployed state on 2026-08-05.
# The one real secret in this tree (SERVE_API_KEY) is read from Secrets Manager at
# plan time by shared-infra and must never be moved into a file like this.
vpc_id             = "vpc-0763fa52c32ebcf6a"
private_subnet_ids = ["subnet-053357b931f0524d4", "subnet-0bb591861f72dcb7f"]
# No failure_notification_email: this root has no email subscription
# deployed, and setting it would make the plan create one.
