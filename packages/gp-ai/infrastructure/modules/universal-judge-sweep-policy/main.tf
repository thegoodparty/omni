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
# of that — they run in-process against a test container. Every sweep, chat or
# background, needs grant 3: somewhere private to keep its records.
#
# EACH GRANT is narrowed to the keys the judge actually touches. Read
# `runners/background.ts` and `records.ts` before widening any of them: every
# shape below comes from those files, not from a guess about what a harness
# might want.
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
#   3. Records WRITE + READ on the artifacts bucket, under `_judge/` only.
#      The sweep's own record store (gp-api judge `records.ts`): every arm's
#      answer at `_judge/<sweepId>/records/<arm>/<agentId>/<caseId>-<n>.json`,
#      the arm manifests beside them, and the panel's per-case rulings at
#      `_judge/<sweepId>/rulings/<agentId>.json`. Kept so a rubric change can
#      re-grade a sweep at no agent cost, and so a bench can be read probe by
#      probe after the job is gone. Unlike grant 2 this one IS head-anchored:
#      real artifact keys start with an experiment id, which the dispatch
#      Lambda holds to `^[a-z]`, so no run's key can start with `_judge/`.
#      That check is the only one: the broker's mint pattern also admits a
#      leading underscore, so loosening the Lambda's would reopen this.
#      This is restricted data: a record carries the agent's whole answer
#      and every SQL statement it ran against the constituent tables. It
#      belongs in this private bucket and nowhere public, which is why the
#      workflow does not upload records as an Actions artifact.
#
#   4. SendMessage on the dispatch queue, and GetQueueUrl on it, which is how
#      judge.yml finds the queue to send to: a lookup on the one queue,
#      returning its URL and nothing else. Without it the lookup fails, the
#      sweep has nowhere to dispatch, and every background agent is refused.
#      Send only otherwise: the sweep never receives,
#      deletes, or changes queue attributes.
#
#   5. ListBucket on both buckets, which is NOT about enumeration and is the
#      one grant here that exists for a reason other than an action the runner
#      takes. S3 hides key existence from a principal that cannot list: without
#      s3:ListBucket, GetObject on a key that does not exist returns 403
#      AccessDenied instead of 404 NoSuchKey. The poll depends on telling those
#      apart — `ObjectStore.getText` is specified to "resolve undefined for a
#      key that does not exist yet, the normal state while a run is still
#      going", and the S3 adapter implements that as `if (!(err instanceof
#      NoSuchKey)) throw err`. With GetObject alone, every poll of an artifact
#      that has not landed yet throws AccessDenied and the run aborts seconds
#      after dispatch, having paid for it. The same 403 hits the first
#      content-addressed read of a `_judge/` config that has not been staged
#      before.
#
#      On the metadata bucket it carries an `s3:prefix` condition, so it can
#      only list under `_judge/`. On the artifacts bucket it CANNOT be
#      conditioned the same way, for the reason given above: the judge marker
#      is in the run-id segment, not at the head of the key, and `s3:prefix`
#      matches from the head. So this grant does let the judge see the key
#      NAMES of real runs on that bucket — agent ids and run ids. It does not
#      let it read them: GetObject stays restricted to `*/_judge-*/*`. That is
#      a real widening and it is the price of a poll that can tell "not yet"
#      from "not allowed"; narrowing it further needs the artifact key layout
#      to change, which is a runner change rather than a policy one.
#
# DELIBERATELY ABSENT, and each omission is a decision:
#   * No write to the artifacts bucket outside `_judge/`. The judge reads what
#     a run produced; the runner and the broker are what write there.
#   * No s3:DeleteObject anywhere. A sweep that could delete could destroy a
#     real run's artifact, and nothing in the capture path removes anything.
#   * No sqs:ReceiveMessage / DeleteMessage. Consuming the dispatch queue is
#     the control plane's job, and a harness that could consume could starve
#     real runs.
#   * No access to the inputs bucket (gp-agent-run-inputs-*). That holds
#     user-uploaded files; no judge case supplies one.
#
# ATTACHED BELOW to a role of the judge's own, not to the shared deploy role,
# which is far more privileged than a test harness needs.
# ---------------------------------------------------------------------------

resource "aws_iam_policy" "judge_sweep" {
  name        = local.policy_name
  # Frozen: IAM cannot update a policy's description, so any edit here makes
  # Terraform replace the policy and its attachment, which CI refuses to apply.
  description = "Universal Judge background sweep: stage an override under _judge/ in ${local.metadata_bucket}, read its own _judge- run artifacts in ${local.artifacts_bucket}, send to ${local.dispatch_queue}, and list both buckets so a missing key returns 404 rather than 403. Attach to the role the judge workflow assumes. dev only."

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
        Sid      = "KeepJudgeRecords"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = ["arn:aws:s3:::${local.artifacts_bucket}/_judge/*"]
      },
      {
        Sid      = "ReadOwnJudgeRunArtifacts"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = ["arn:aws:s3:::${local.artifacts_bucket}/*/_judge-*/*"]
      },
      # Both ListBucket grants exist so GetObject on a missing key returns 404
      # rather than 403 — see note 5 above. Neither is here to enumerate.
      {
        Sid      = "DistinguishNotYetFromNotAllowedWhenStaging"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = ["arn:aws:s3:::${local.metadata_bucket}"]
        Condition = {
          StringLike = {
            "s3:prefix" = ["_judge/*"]
          }
        }
      },
      {
        Sid      = "DistinguishNotYetFromNotAllowedWhenPolling"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = ["arn:aws:s3:::${local.artifacts_bucket}"]
      },
      {
        Sid    = "DispatchJudgeRuns"
        Effect = "Allow"
        Action = ["sqs:SendMessage", "sqs:GetQueueUrl"]
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

# ---------------------------------------------------------------------------
# The role the judge's sweep job assumes, and who may assume it.
#
# THE TRUST IS THE PART THAT MATTERS, more than the grants above: it decides
# which workflow runs get AWS credentials at all. Two pins, both exact:
#
#   * `sub`, the run's ref: main in omni. A sweep is always ABOUT a pull
#     request and never RUNS on one; both entry points are default-branch
#     events. A pull_request subject would let a PR's own edited judge.yml
#     assume this role.
#   * `job_workflow_ref`, the one workflow file: judge.yml on main. `sub` is
#     per-ref, not per-workflow, so without this every job in omni that runs on
#     main could assume a role that starts agents and spends money. The two
#     claims name the same ref, or neither pin means anything.
#
# judgeWorkflow.test.ts (gp-api) holds this block to all of that, and to the
# role name and session length judge.yml relies on. Widen it there first.
#
# The GitHub OIDC provider is not managed here (thegoodparty/ops owns it), so
# its ARN is built rather than looked up: a lookup needs
# iam:GetOpenIDConnectProvider, which the deploy role does not hold.
# ---------------------------------------------------------------------------

locals {
  judge_role_name = "github-actions-judge-sweep"
  github_oidc     = "token.actions.githubusercontent.com"
}

resource "aws_iam_role" "judge_sweep" {
  name        = local.judge_role_name
  description = "Universal Judge background sweep. Assumable only by omni's judge.yml on main, via GitHub OIDC. ${var.environment} only."

  # Longer than the sweep job's three hours, because the job waits rather than
  # deploys: a background run's poll outlasting its credentials dies after the
  # dispatch, with the task still billing. judge.yml asks for exactly this.
  max_session_duration = 14400

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/${local.github_oidc}"
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud"              = "sts.amazonaws.com"
            "token.actions.githubusercontent.com:sub"              = "repo:thegoodparty/omni:ref:refs/heads/main"
            "token.actions.githubusercontent.com:job_workflow_ref" = "thegoodparty/omni/.github/workflows/judge.yml@refs/heads/main"
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "judge_sweep" {
  role       = aws_iam_role.judge_sweep.name
  policy_arn = aws_iam_policy.judge_sweep.arn
}

output "role_arn" {
  description = "The role judge.yml's sweep job assumes."
  value       = aws_iam_role.judge_sweep.arn
}
