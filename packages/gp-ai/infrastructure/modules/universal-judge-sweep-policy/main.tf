terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "environment" {
  description = <<-EOT
    Environment name. dev ONLY, and the validation is the point rather than
    boilerplate: the broker refuses a judge override unless ENVIRONMENT is
    'dev' (mint_run_token.py JUDGE_OVERRIDE_ENVIRONMENT) and the dispatch
    Lambda refuses it again (_JUDGE_OVERRIDE_ENVIRONMENT). A prod copy of this
    policy would grant access that nothing downstream would honour, so the
    only thing it could do is widen a blast radius for no capability.
  EOT
  type        = string

  validation {
    condition     = var.environment == "dev"
    error_message = "environment must be dev: the judge override path is refused outside dev by both the broker and the dispatch Lambda"
  }
}

locals {
  policy_name = "UniversalJudgeSweep-${var.environment}"

  metadata_bucket  = "agent-experiment-metadata-${var.environment}"
  artifacts_bucket = "gp-agent-artifacts-${var.environment}"
  dispatch_queue   = "agent-dispatch-${var.environment}.fifo"
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# ---------------------------------------------------------------------------
# What the Universal Judge's sweep job needs, and nothing else.
#
# The sweep drives background (PMF experiment) agents by staging an override
# config in S3 and sending one dispatch message per run. Chat agents need none
# of this — they run in-process against a test container — so this policy
# exists solely for the background half.
#
# THREE GRANTS, each narrowed to the keys the runner actually touches. Read
# `runners/background.ts` before widening any of them: every shape below comes
# from that file, not from a guess about what a harness might want.
#
#   1. Staging WRITE + READ on the metadata bucket, under `_judge/` only.
#      `stageAgentConfig` writes exactly two objects per agent-config digest:
#      `_judge/<agentId>/<digest>/manifest.json` and `.../instruction.md`.
#      The prefix is `JUDGE_KEY_PREFIX` in @goodparty_org/contracts, and the
#      dispatch Lambda validates the pair against it, so a key outside the
#      prefix is refused downstream as well as unwritable here.
#
#   2. Artifact READ on the artifacts bucket, under any `_judge-` RUN.
#      This one cannot be prefix-scoped the way the first is, and the reason
#      is worth stating: artifact keys are `<agentId>/<runId>/artifact.json`
#      and `<agentId>/<runId>/logs/...`, so the judge marker lives in the RUN
#      ID segment, not at the head of the key. `*/_judge-*/*` is the narrowest
#      correct expression of "only this judge's own runs" — it still refuses
#      every artifact belonging to a real experiment run.
#
#   3. SendMessage on the dispatch queue. Send only: the sweep never receives,
#      deletes, or changes queue attributes.
#
# DELIBERATELY ABSENT, and each omission is a decision:
#   * No s3:ListBucket anywhere. The runner always fetches an exact key, so
#     enumeration would only serve something this harness does not do. Same
#     discipline as the agent-run-inputs module's read policy.
#   * No write of any kind to the artifacts bucket. The judge reads what a run
#     produced; the runner and the broker are what write there.
#   * No s3:DeleteObject anywhere. A sweep that could delete could destroy a
#     real run's artifact, and nothing in the capture path removes anything.
#   * No sqs:ReceiveMessage / DeleteMessage. Consuming the dispatch queue is
#     the control plane's job, and a harness that could consume could starve
#     real runs.
#   * No access to the inputs bucket (gp-agent-run-inputs-*). That holds
#     user-uploaded files; no judge case supplies one.
#
# NOT ATTACHED HERE, and this is the part that needs a human. The GitHub
# Actions OIDC provider and the role the workflows assume (`vars.AWS_ROLE_ARN`)
# are NOT managed in this repository — there is no
# aws_iam_openid_connect_provider and no token.actions.githubusercontent
# anywhere in this tree. So this module can define the policy and hand back its
# ARN, but someone with account access has to attach it to the role the judge
# workflow assumes, and should prefer a dedicated judge role over the shared
# deploy role, which is far more privileged than a test harness needs.
# ---------------------------------------------------------------------------

resource "aws_iam_policy" "judge_sweep" {
  name        = local.policy_name
  description = "Universal Judge background sweep: stage an override under _judge/ in ${local.metadata_bucket}, read its own _judge- run artifacts in ${local.artifacts_bucket}, and send to ${local.dispatch_queue}. Attach to the role the judge workflow assumes. dev only."

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "StageJudgeOverrideConfig"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = ["arn:aws:s3:::${local.metadata_bucket}/_judge/*"]
      },
      {
        Sid      = "ReadOwnJudgeRunArtifacts"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = ["arn:aws:s3:::${local.artifacts_bucket}/*/_judge-*/*"]
      },
      {
        Sid    = "DispatchJudgeRuns"
        Effect = "Allow"
        Action = ["sqs:SendMessage"]
        Resource = [
          "arn:aws:sqs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:${local.dispatch_queue}"
        ]
      }
    ]
  })
}

output "policy_arn" {
  description = "Managed IAM policy ARN for the Universal Judge's background sweep. ATTACH MANUALLY to the role the judge workflow assumes — the OIDC provider and that role are not managed in this repository. Prefer a dedicated judge role to the shared deploy role."
  value       = aws_iam_policy.judge_sweep.arn
}

output "policy_name" {
  description = "Name of the managed policy, for locating it in the console."
  value       = aws_iam_policy.judge_sweep.name
}
