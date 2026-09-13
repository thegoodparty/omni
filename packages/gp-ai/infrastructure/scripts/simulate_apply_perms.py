#!/usr/bin/env python3
"""Simulate the CI deploy role's IAM permissions against a terraform plan's
resource changes, so a missing apply-time permission fails the PR instead of
the release train's real `terraform apply`.

Invoked by ci-simulate-apply-perms.sh, once per CI run, against every
`<slug>.json` file ci-plan-root.sh wrote to $PLAN_DIR (one per dev root).

Stdlib-only, shelling out to the `aws` CLI (already present on GitHub-hosted
runners) instead of boto3. `uv run` would sync the whole gp-ai root project
— pandas, spacy, faiss-cpu, umap-learn, and the rest of the scientific stack
this script never imports — into a CI job that currently installs none of
it, just to make one paginated API call. Plain `python3` avoids that entirely
and keeps this guard fast and dependency-free.

Exit codes:
  0  every simulated action was "allowed" (or the guard fail-opened — see below)
  1  at least one action was NOT allowed, or plan JSON could not be read
  2  usage error
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

# ---------------------------------------------------------------------------
# aws CLI plumbing
# ---------------------------------------------------------------------------


class AwsCliError(Exception):
    def __init__(self, args: list[str], returncode: int, stderr: str) -> None:
        self.args_ = args
        self.returncode = returncode
        self.stderr = stderr
        super().__init__(f"aws {' '.join(args)} failed ({returncode}): {stderr.strip()}")

    def is_access_denied(self) -> bool:
        # Covers both the classic IAM "AccessDenied" and the newer
        # "AccessDeniedException" shape some services use; the CLI puts the
        # error code and message on stderr, not stdout, on failure.
        return "AccessDenied" in self.stderr or "is not authorized to perform" in self.stderr


def run_aws(args: list[str]) -> dict[str, Any]:
    proc = subprocess.run(
        ["aws", *args, "--output", "json"],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise AwsCliError(args, proc.returncode, proc.stderr)
    return json.loads(proc.stdout) if proc.stdout.strip() else {}


# ---------------------------------------------------------------------------
# Resource type -> IAM action / ARN mapping
#
# Built from `grep -rhoE 'resource "aws_[a-z_0-9]+"' infrastructure/modules |
# sort | uniq -c`, i.e. every managed resource type gp-ai's terraform actually
# creates today. Extend this table as new resource types show up — an
# unmapped type produces a visible "skipped" log line rather than silence, so
# gaps are easy to spot instead of being invisible false negatives.
#
# Each entry's `arn` function returns either a concrete predicted ARN or "*"
# when the real ARN depends on a value AWS only assigns at apply time (a
# random suffix, a generated id). "*" is a deliberate, logged choice, never a
# guess at a shape we're not sure of.
# ---------------------------------------------------------------------------


def _s(after: dict[str, Any], *names: str) -> str | None:
    """First non-null value of `after` under any of `names`."""
    for n in names:
        v = after.get(n)
        if isinstance(v, str) and v:
            return v
    return None


def _as_arn_or(value: str | None, builder: Callable[[str], str]) -> str:
    if not value:
        return "*"
    # Some arguments (e.g. aws_lambda_permission.function_name,
    # aws_iam_role_policy.role) accept either a bare name or a full ARN.
    # A value already shaped like an ARN is the real resource; don't
    # re-wrap it in a name-shaped ARN template.
    if value.startswith("arn:aws:"):
        return value
    return builder(value)


@dataclass
class ResourceMapping:
    create: list[str]
    arn: Callable[[dict[str, Any], str, str], str]
    update: list[str] | None = None
    delete: list[str] | None = None

    def actions_for(self, action: str) -> list[str] | None:
        return {"create": self.create, "update": self.update, "delete": self.delete}.get(action)


def _lambda_arn(after: dict[str, Any], acct: str, region: str) -> str:
    return _as_arn_or(_s(after, "function_name"), lambda n: f"arn:aws:lambda:{region}:{acct}:function:{n}")


def _dynamodb_arn(after: dict[str, Any], acct: str, region: str) -> str:
    name = _s(after, "name")
    return f"arn:aws:dynamodb:{region}:{acct}:table/{name}" if name else "*"


def _iam_role_arn_from(after: dict[str, Any], acct: str, *names: str) -> str:
    return _as_arn_or(_s(after, *names), lambda n: f"arn:aws:iam::{acct}:role/{n}")


def _iam_policy_arn(after: dict[str, Any], acct: str, region: str) -> str:
    del region
    name = _s(after, "name")
    if not name:
        return "*"
    path = after.get("path") or "/"
    return f"arn:aws:iam::{acct}:policy{path}{name}"


def _ecs_cluster_arn(after: dict[str, Any], acct: str, region: str) -> str:
    name = _s(after, "name")
    return f"arn:aws:ecs:{region}:{acct}:cluster/{name}" if name else "*"


def _ecs_task_definition_arn(after: dict[str, Any], acct: str, region: str) -> str:
    # The revision number is assigned by ECS at register time, so the exact
    # ARN isn't knowable pre-apply. task-definition ARNs accept a trailing
    # wildcard in place of ":<revision>", which is a real, documented ARN
    # shape (not a guess) — narrower than falling back to "*".
    family = _s(after, "family")
    return f"arn:aws:ecs:{region}:{acct}:task-definition/{family}:*" if family else "*"


def _ecs_service_arn(after: dict[str, Any], acct: str, region: str) -> str:
    name = _s(after, "name")
    cluster = _s(after, "cluster")
    if not (name and cluster):
        return "*"
    cluster_name = cluster.rsplit("/", 1)[-1] if cluster.startswith("arn:aws:") else cluster
    return f"arn:aws:ecs:{region}:{acct}:service/{cluster_name}/{name}"


def _log_group_arn(after: dict[str, Any], acct: str, region: str) -> str:
    name = _s(after, "name", "log_group_name")
    return f"arn:aws:logs:{region}:{acct}:log-group:{name}:*" if name else "*"


def _alarm_arn(after: dict[str, Any], acct: str, region: str) -> str:
    name = _s(after, "alarm_name")
    return f"arn:aws:cloudwatch:{region}:{acct}:alarm:{name}" if name else "*"


def _event_rule_arn(after: dict[str, Any], acct: str, region: str) -> str:
    name = _s(after, "name", "rule")
    return f"arn:aws:events:{region}:{acct}:rule/{name}" if name else "*"


def _sns_topic_arn(after: dict[str, Any], acct: str, region: str) -> str:
    return _as_arn_or(_s(after, "topic_arn", "arn", "name"), lambda n: f"arn:aws:sns:{region}:{acct}:{n}")


def _sqs_queue_arn(after: dict[str, Any], acct: str, region: str) -> str:
    name = _s(after, "name")
    return f"arn:aws:sqs:{region}:{acct}:{name}" if name else "*"


def _s3_bucket_arn(after: dict[str, Any], acct: str, region: str) -> str:
    del acct, region
    bucket = _s(after, "bucket")
    return f"arn:aws:s3:::{bucket}" if bucket else "*"


def _secretsmanager_secret_arn(after: dict[str, Any], acct: str, region: str) -> str:
    # aws_secretsmanager_secret_version.secret_id is commonly a direct
    # reference to the parent aws_secretsmanager_secret's `id` (which the
    # provider documents as the full ARN, suffix included) — go through
    # _as_arn_or so an already-ARN-shaped value is used as-is instead of
    # being re-wrapped into a doubled, malformed ARN. Only a bare name falls
    # through to the template: AWS appends a random 6-char suffix at
    # creation, so the exact ARN is never knowable pre-apply from a name
    # alone, and a `-*` suffix wildcard is the real, documented ARN shape for
    # "any suffix of this secret" — narrower and more honest than a bare "*".
    return _as_arn_or(_s(after, "name", "secret_id"), lambda n: f"arn:aws:secretsmanager:{region}:{acct}:secret:{n}-*")


def _sfn_arn(after: dict[str, Any], acct: str, region: str) -> str:
    name = _s(after, "name")
    return f"arn:aws:states:{region}:{acct}:stateMachine:{name}" if name else "*"


def _route53_zone_arn(after: dict[str, Any], acct: str, region: str) -> str:
    del acct, region
    zone_id = _s(after, "zone_id")
    return f"arn:aws:route53:::hostedzone/{zone_id}" if zone_id else "*"


def _star(after: dict[str, Any], acct: str, region: str) -> str:
    del after, acct, region
    return "*"


TYPE_MAP: dict[str, ResourceMapping] = {
    "aws_lambda_function": ResourceMapping(
        create=["lambda:CreateFunction", "lambda:TagResource"],
        update=["lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration"],
        delete=["lambda:DeleteFunction"],
        arn=_lambda_arn,
    ),
    "aws_lambda_permission": ResourceMapping(
        create=["lambda:AddPermission"],
        delete=["lambda:RemovePermission"],
        arn=lambda after, acct, region: _as_arn_or(
            _s(after, "function_name"), lambda n: f"arn:aws:lambda:{region}:{acct}:function:{n}"
        ),
    ),
    "aws_lambda_function_event_invoke_config": ResourceMapping(
        create=["lambda:PutFunctionEventInvokeConfig"],
        update=["lambda:UpdateFunctionEventInvokeConfig"],
        delete=["lambda:DeleteFunctionEventInvokeConfig"],
        arn=lambda after, acct, region: _as_arn_or(
            _s(after, "function_name"), lambda n: f"arn:aws:lambda:{region}:{acct}:function:{n}"
        ),
    ),
    "aws_lambda_event_source_mapping": ResourceMapping(
        # The mapping UUID (part of its own ARN) is server-generated, and the
        # source ARN (SQS/DynamoDB stream) is a permission on THAT resource,
        # not this one — "*" here just checks the base action is grantable.
        create=["lambda:CreateEventSourceMapping"],
        delete=["lambda:DeleteEventSourceMapping"],
        arn=_star,
    ),
    "aws_dynamodb_table": ResourceMapping(
        create=["dynamodb:CreateTable", "dynamodb:TagResource"],
        update=["dynamodb:UpdateTable"],
        delete=["dynamodb:DeleteTable"],
        arn=_dynamodb_arn,
    ),
    "aws_iam_role": ResourceMapping(
        create=["iam:CreateRole", "iam:TagRole"],
        update=["iam:UpdateRole", "iam:UpdateAssumeRolePolicy"],
        delete=["iam:DeleteRole"],
        arn=lambda after, acct, region: (
            "*" if after.get("name_prefix") and not after.get("name") else _iam_role_arn_from(after, acct, "name")
        ),
    ),
    "aws_iam_role_policy": ResourceMapping(
        create=["iam:PutRolePolicy"],
        update=["iam:PutRolePolicy"],
        delete=["iam:DeleteRolePolicy"],
        arn=lambda after, acct, region: _iam_role_arn_from(after, acct, "role"),
    ),
    "aws_iam_role_policy_attachment": ResourceMapping(
        create=["iam:AttachRolePolicy"],
        delete=["iam:DetachRolePolicy"],
        arn=lambda after, acct, region: _iam_role_arn_from(after, acct, "role"),
    ),
    "aws_iam_policy": ResourceMapping(
        create=["iam:CreatePolicy", "iam:TagPolicy"],
        delete=["iam:DeletePolicy"],
        arn=_iam_policy_arn,
    ),
    "aws_ecs_cluster": ResourceMapping(
        create=["ecs:CreateCluster"],
        delete=["ecs:DeleteCluster"],
        arn=_ecs_cluster_arn,
    ),
    "aws_ecs_task_definition": ResourceMapping(
        create=["ecs:RegisterTaskDefinition"],
        delete=["ecs:DeregisterTaskDefinition"],
        arn=_ecs_task_definition_arn,
    ),
    "aws_ecs_service": ResourceMapping(
        create=["ecs:CreateService"],
        update=["ecs:UpdateService"],
        delete=["ecs:DeleteService"],
        arn=_ecs_service_arn,
    ),
    "aws_cloudwatch_log_group": ResourceMapping(
        create=["logs:CreateLogGroup", "logs:TagResource", "logs:PutRetentionPolicy"],
        delete=["logs:DeleteLogGroup"],
        arn=_log_group_arn,
    ),
    "aws_cloudwatch_metric_alarm": ResourceMapping(
        create=["cloudwatch:PutMetricAlarm"],
        update=["cloudwatch:PutMetricAlarm"],
        delete=["cloudwatch:DeleteAlarms"],
        arn=_alarm_arn,
    ),
    "aws_cloudwatch_log_metric_filter": ResourceMapping(
        create=["logs:PutMetricFilter"],
        delete=["logs:DeleteMetricFilter"],
        arn=_log_group_arn,
    ),
    "aws_cloudwatch_event_rule": ResourceMapping(
        create=["events:PutRule", "events:TagResource"],
        delete=["events:DeleteRule"],
        arn=_event_rule_arn,
    ),
    "aws_cloudwatch_event_target": ResourceMapping(
        create=["events:PutTargets"],
        delete=["events:RemoveTargets"],
        arn=_event_rule_arn,
    ),
    "aws_sns_topic": ResourceMapping(
        create=["sns:CreateTopic", "sns:TagResource"],
        delete=["sns:DeleteTopic"],
        arn=_sns_topic_arn,
    ),
    "aws_sns_topic_subscription": ResourceMapping(
        create=["sns:Subscribe"],
        delete=["sns:Unsubscribe"],
        arn=_sns_topic_arn,
    ),
    "aws_sns_topic_policy": ResourceMapping(
        create=["sns:SetTopicAttributes"],
        update=["sns:SetTopicAttributes"],
        arn=_sns_topic_arn,
    ),
    "aws_s3_bucket": ResourceMapping(
        create=["s3:CreateBucket"],
        delete=["s3:DeleteBucket"],
        arn=_s3_bucket_arn,
    ),
    "aws_s3_bucket_server_side_encryption_configuration": ResourceMapping(
        create=["s3:PutEncryptionConfiguration"], arn=_s3_bucket_arn
    ),
    "aws_s3_bucket_public_access_block": ResourceMapping(create=["s3:PutBucketPublicAccessBlock"], arn=_s3_bucket_arn),
    "aws_s3_bucket_versioning": ResourceMapping(create=["s3:PutBucketVersioning"], arn=_s3_bucket_arn),
    "aws_s3_bucket_lifecycle_configuration": ResourceMapping(
        create=["s3:PutLifecycleConfiguration"], arn=_s3_bucket_arn
    ),
    "aws_s3_bucket_policy": ResourceMapping(create=["s3:PutBucketPolicy"], arn=_s3_bucket_arn),
    "aws_s3_bucket_notification": ResourceMapping(create=["s3:PutBucketNotification"], arn=_s3_bucket_arn),
    "aws_s3_bucket_cors_configuration": ResourceMapping(create=["s3:PutBucketCORS"], arn=_s3_bucket_arn),
    "aws_sqs_queue": ResourceMapping(
        create=["sqs:CreateQueue", "sqs:TagQueue"],
        delete=["sqs:DeleteQueue"],
        arn=_sqs_queue_arn,
    ),
    "aws_lb": ResourceMapping(create=["elasticloadbalancing:CreateLoadBalancer"], arn=_star),
    "aws_lb_target_group": ResourceMapping(create=["elasticloadbalancing:CreateTargetGroup"], arn=_star),
    "aws_lb_listener": ResourceMapping(create=["elasticloadbalancing:CreateListener"], arn=_star),
    "aws_lb_target_group_attachment": ResourceMapping(create=["elasticloadbalancing:RegisterTargets"], arn=_star),
    "aws_secretsmanager_secret": ResourceMapping(
        create=["secretsmanager:CreateSecret", "secretsmanager:TagResource"],
        delete=["secretsmanager:DeleteSecret"],
        arn=_secretsmanager_secret_arn,
    ),
    "aws_secretsmanager_secret_version": ResourceMapping(
        create=["secretsmanager:PutSecretValue"],
        arn=_secretsmanager_secret_arn,
    ),
    "aws_security_group": ResourceMapping(
        create=["ec2:CreateSecurityGroup", "ec2:CreateTags"],
        delete=["ec2:DeleteSecurityGroup"],
        arn=_star,  # sg-xxxx id is assigned at creation
    ),
    "aws_security_group_rule": ResourceMapping(
        create=["ec2:AuthorizeSecurityGroupIngress", "ec2:AuthorizeSecurityGroupEgress"],
        delete=["ec2:RevokeSecurityGroupIngress", "ec2:RevokeSecurityGroupEgress"],
        arn=_star,
    ),
    "aws_appautoscaling_target": ResourceMapping(
        create=["application-autoscaling:RegisterScalableTarget"],
        delete=["application-autoscaling:DeregisterScalableTarget"],
        arn=_star,
    ),
    "aws_appautoscaling_policy": ResourceMapping(
        create=["application-autoscaling:PutScalingPolicy"],
        delete=["application-autoscaling:DeleteScalingPolicy"],
        arn=_star,
    ),
    "aws_route53_record": ResourceMapping(
        create=["route53:ChangeResourceRecordSets"],
        update=["route53:ChangeResourceRecordSets"],
        delete=["route53:ChangeResourceRecordSets"],
        arn=_route53_zone_arn,
    ),
    "aws_route53_resolver_firewall_rule_group": ResourceMapping(
        create=["route53resolver:CreateFirewallRuleGroup"], arn=_star
    ),
    "aws_route53_resolver_firewall_domain_list": ResourceMapping(
        create=["route53resolver:CreateFirewallDomainList"], arn=_star
    ),
    "aws_route53_resolver_firewall_rule": ResourceMapping(create=["route53resolver:CreateFirewallRule"], arn=_star),
    "aws_acm_certificate": ResourceMapping(create=["acm:RequestCertificate"], arn=_star),
    "aws_acm_certificate_validation": ResourceMapping(create=["acm:DescribeCertificate"], arn=_star),
    "aws_sfn_state_machine": ResourceMapping(
        create=["states:CreateStateMachine"],
        update=["states:UpdateStateMachine"],
        delete=["states:DeleteStateMachine"],
        arn=_sfn_arn,
    ),
}

BATCH_SIZE = 20  # simulate-principal-policy accepts up to 100 action names, but a
# small batch keeps any single failing call's blast radius (and the retry cost
# of a transient API hiccup) small.


@dataclass
class Check:
    action: str
    resource_arn: str
    resource_address: str
    resource_type: str


@dataclass
class Verdict:
    action: str
    resource_arn: str
    decision: str
    matched_statement: str
    sources: list[str] = field(default_factory=list)


def collect_checks(plan: dict[str, Any], account_id: str, region: str, warn: Callable[[str], None]) -> list[Check]:
    checks: list[Check] = []
    unmapped_types_seen: set[str] = set()
    for rc in plan.get("resource_changes") or []:
        if rc.get("mode") != "managed":
            continue
        change = rc.get("change") or {}
        actions = change.get("actions") or []
        rtype = rc.get("type", "")
        address = rc.get("address", "<unknown address>")

        relevant = [a for a in ("create", "update", "delete") if a in actions]
        if not relevant:
            continue

        mapping = TYPE_MAP.get(rtype)
        if mapping is None:
            if rtype not in unmapped_types_seen:
                unmapped_types_seen.add(rtype)
                warn(f"no action mapping for {rtype}, skipped (seen on {address})")
            continue

        after = change.get("after") or {}
        arn = mapping.arn(after, account_id, region)
        for verb in relevant:
            iam_actions = mapping.actions_for(verb)
            if not iam_actions:
                warn(f"no {verb}-action mapping for {rtype}, skipping this change on {address}")
                continue
            for action in iam_actions:
                checks.append(Check(action=action, resource_arn=arn, resource_address=address, resource_type=rtype))
    return checks


def chunked(items: list[Any], size: int) -> list[list[Any]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def simulate(
    role_arn: str, checks: list[Check], call: Callable[[list[str], list[str]], dict[str, Any]]
) -> list[Verdict]:
    """Group checks by resource ARN, batch each group's actions, call
    `call(action_names, resource_arns)` per batch, and fold the results back
    into one Verdict per (action, resource_arn) pair with every contributing
    resource address attached.
    """
    del role_arn  # bound into `call` by the caller; kept for signature clarity
    by_resource: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    for c in checks:
        by_resource[c.resource_arn][c.action].append(c.resource_address)

    verdicts: dict[tuple[str, str], Verdict] = {}
    for resource_arn, actions_map in by_resource.items():
        for batch in chunked(list(actions_map.keys()), BATCH_SIZE):
            result = call(batch, [resource_arn])
            for ev in result.get("EvaluationResults", []):
                action = ev["EvalActionName"]
                key = (action, resource_arn)
                matched = ev.get("MatchedStatements") or []
                matched_desc = ", ".join(m.get("SourcePolicyId", "?") for m in matched) if matched else "-"
                verdicts[key] = Verdict(
                    action=action,
                    resource_arn=resource_arn,
                    decision=ev["EvalDecision"],
                    matched_statement=matched_desc,
                    sources=sorted(set(actions_map.get(action, []))),
                )
    return list(verdicts.values())


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def load_plans(plan_dir: str, warn: Callable[[str], None]) -> list[dict[str, Any]]:
    if not os.path.isdir(plan_dir):
        warn(f"plan dir {plan_dir} does not exist; nothing to simulate")
        return []
    plans = []
    for fname in sorted(os.listdir(plan_dir)):
        if not fname.endswith(".json"):
            continue
        path = os.path.join(plan_dir, fname)
        try:
            with open(path) as f:
                text = f.read().strip()
            plans.append(json.loads(text) if text else {})
        except (OSError, json.JSONDecodeError) as e:
            warn(f"could not read/parse {path}: {e}; skipping this root's plan")
    return plans


def make_aws_call(role_arn: str) -> Callable[[list[str], list[str]], dict[str, Any]]:
    def call(action_names: list[str], resource_arns: list[str]) -> dict[str, Any]:
        args = ["iam", "simulate-principal-policy", "--policy-source-arn", role_arn, "--action-names", *action_names]
        if resource_arns and resource_arns != ["*"]:
            args += ["--resource-arns", *resource_arns]
        return run_aws(args)

    return call


def print_verdict_table(bad: list[Verdict]) -> None:
    print("\naction | resource | decision | matched statement | planned by")
    print("--- | --- | --- | --- | ---")
    for v in bad:
        print(f"{v.action} | {v.resource_arn} | {v.decision} | {v.matched_statement} | {', '.join(v.sources)}")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan-dir", default=os.environ.get("PLAN_DIR", "/tmp/tfplans"))
    parser.add_argument("--deploy-role-arn", default=os.environ.get("DEPLOY_ROLE_ARN"))
    parser.add_argument("--region", default=os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION"))
    parser.add_argument("--self-test", action="store_true", help="run the built-in fixture-based self-test and exit")
    args = parser.parse_args(argv)

    if args.self_test:
        return run_self_test()

    warnings: list[str] = []

    def warn(msg: str) -> None:
        warnings.append(msg)
        print(f"::warning::{msg}", file=sys.stderr)

    try:
        identity = run_aws(["sts", "get-caller-identity"])
    except AwsCliError as e:
        if e.is_access_denied():
            print(
                "::warning::simulate-apply-perms: sts:GetCallerIdentity denied for the CI runner's own "
                "credentials. This guard cannot bootstrap and is FAIL-OPEN by design — grant "
                "sts:GetCallerIdentity (and iam:SimulatePrincipalPolicy on its own role ARN) to unblock it. "
                "Not blocking this PR.",
                file=sys.stderr,
            )
            return 0
        print(
            f"::error::simulate-apply-perms: could not determine AWS account ({e}); not fail-open for this error",
            file=sys.stderr,
        )
        return 1

    account_id = identity.get("Account")
    if not account_id:
        print("::error::simulate-apply-perms: sts:GetCallerIdentity returned no Account", file=sys.stderr)
        return 1
    region = args.region or "us-west-2"
    role_arn = args.deploy_role_arn or f"arn:aws:iam::{account_id}:role/github-actions-pulumi-deploy"

    plans = load_plans(args.plan_dir, warn)
    if not plans:
        print("simulate-apply-perms: no plan JSON found; nothing to simulate")
        return 0

    checks: list[Check] = []
    for plan in plans:
        checks.extend(collect_checks(plan, account_id, region, warn))

    if not checks:
        print(
            "simulate-apply-perms: no create/update/delete resource changes with a known action mapping; nothing to simulate"
        )
        return 0

    print(f"simulate-apply-perms: simulating {len(checks)} planned action(s) against {role_arn}")

    call = make_aws_call(role_arn)
    try:
        verdicts = simulate(role_arn, checks, call)
    except AwsCliError as e:
        if e.is_access_denied():
            print(
                f"::warning::simulate-apply-perms: iam:SimulatePrincipalPolicy denied for the CI runner "
                f"against {role_arn}. This guard is FAIL-OPEN by design so a missing bootstrap grant "
                f"never blocks every PR — grant the runner's role iam:SimulatePrincipalPolicy and "
                f"iam:GetContextKeysForPrincipalPolicy on {role_arn} to enable this check. Not blocking this PR.",
                file=sys.stderr,
            )
            return 0
        print(
            f"::error::simulate-apply-perms: simulate-principal-policy call failed ({e}); not fail-open for this error",
            file=sys.stderr,
        )
        return 1

    bad = [v for v in verdicts if v.decision != "allowed"]
    if bad:
        print(
            f"\nsimulate-apply-perms: {len(bad)} of {len(verdicts)} simulated action(s) are NOT allowed for the deploy role."
        )
        print_verdict_table(bad)
        print(
            "\nThe release train's real `terraform apply` will fail on these with AccessDenied. "
            "Grant the missing permission(s) to github-actions-pulumi-deploy before merging."
        )
        return 1

    print(f"simulate-apply-perms: all {len(verdicts)} simulated action(s) allowed for the deploy role.")
    return 0


# ---------------------------------------------------------------------------
# Self-test — no AWS calls. Exercises the mapping table and verdict logic
# against canned plan JSON and a canned simulate() response, plus the
# fail-open path on a canned AccessDenied. Runnable in local verify with no
# AWS credentials required.
# ---------------------------------------------------------------------------


def run_self_test() -> int:
    passed = 0
    failed: list[str] = []

    def check(name: str, cond: bool) -> None:
        nonlocal passed
        if cond:
            passed += 1
        else:
            failed.append(name)

    account_id, region = "333022194791", "us-west-2"
    warnings: list[str] = []
    plan = {
        "resource_changes": [
            {
                "address": "aws_lambda_function.example",
                "mode": "managed",
                "type": "aws_lambda_function",
                "change": {"actions": ["create"], "after": {"function_name": "autopilot-bot-dev"}},
            },
            {
                "address": "aws_dynamodb_table.example",
                "mode": "managed",
                "type": "aws_dynamodb_table",
                "change": {"actions": ["create"], "after": {"name": "serve-message-v1-dev"}},
            },
            {
                "address": "aws_lb.example",
                "mode": "managed",
                "type": "aws_lb",
                "change": {"actions": ["create"], "after": {}},
            },
            {
                # Not in TYPE_MAP on purpose — exercises the "skipped" log path.
                "address": "aws_made_up_thing.example",
                "mode": "managed",
                "type": "aws_made_up_thing",
                "change": {"actions": ["create"], "after": {}},
            },
            {
                # A data source read must never be collected as a check.
                "address": "data.aws_caller_identity.current",
                "mode": "data",
                "type": "aws_caller_identity",
                "change": {"actions": ["read"], "after": {}},
            },
        ]
    }

    checks = collect_checks(plan, account_id, region, warnings.append)
    check("lambda create maps to lambda:CreateFunction", any(c.action == "lambda:CreateFunction" for c in checks))
    check(
        "lambda ARN predicted from function_name",
        any(c.resource_arn == f"arn:aws:lambda:{region}:{account_id}:function:autopilot-bot-dev" for c in checks),
    )
    check(
        "dynamodb ARN predicted from name",
        any(c.resource_arn == f"arn:aws:dynamodb:{region}:{account_id}:table/serve-message-v1-dev" for c in checks),
    )
    check(
        "aws_lb falls back to '*' (server-generated ARN)",
        any(c.resource_arn == "*" and c.resource_type == "aws_lb" for c in checks),
    )
    check(
        "data source read is never collected as a check",
        not any(c.resource_type == "aws_caller_identity" for c in checks),
    )
    check(
        "unmapped type logs a visible skip warning",
        any("no action mapping for aws_made_up_thing" in w for w in warnings),
    )

    # Regression: aws_secretsmanager_secret_version.secret_id is commonly a
    # direct reference to the parent secret's `id`, which the provider
    # documents as the full ARN. That must be used as-is, not re-wrapped into
    # a doubled ARN like "...:secret:arn:aws:secretsmanager:...-*".
    secret_version_plan = {
        "resource_changes": [
            {
                "address": "aws_secretsmanager_secret_version.example",
                "mode": "managed",
                "type": "aws_secretsmanager_secret_version",
                "change": {
                    "actions": ["create"],
                    "after": {"secret_id": f"arn:aws:secretsmanager:{region}:{account_id}:secret:broker-AbCdEf"},
                },
            }
        ]
    }
    secret_checks = collect_checks(secret_version_plan, account_id, region, warnings.append)
    check(
        "secretsmanager ARN-shaped secret_id is reused as-is, not double-wrapped",
        all(
            c.resource_arn == f"arn:aws:secretsmanager:{region}:{account_id}:secret:broker-AbCdEf"
            for c in secret_checks
        ),
    )

    # Verdict logic: one allowed, one explicit deny.
    def canned_call(action_names: list[str], resource_arns: list[str]) -> dict[str, Any]:
        results = []
        for a in action_names:
            if a == "dynamodb:CreateTable":
                results.append(
                    {
                        "EvalActionName": a,
                        "EvalResourceName": resource_arns[0] if resource_arns else "*",
                        "EvalDecision": "explicitDeny",
                        "MatchedStatements": [{"SourcePolicyId": "DenyDynamoDbCreate"}],
                    }
                )
            else:
                results.append(
                    {
                        "EvalActionName": a,
                        "EvalResourceName": resource_arns[0] if resource_arns else "*",
                        "EvalDecision": "allowed",
                        "MatchedStatements": [],
                    }
                )
        return {"EvaluationResults": results}

    verdicts = simulate("arn:aws:iam::333022194791:role/github-actions-pulumi-deploy", checks, canned_call)
    bad = [v for v in verdicts if v.decision != "allowed"]
    check("verdict flags the explicitly-denied action", any(v.action == "dynamodb:CreateTable" for v in bad))
    check("verdict does not flag the allowed action", not any(v.action == "lambda:CreateFunction" for v in bad))
    check(
        "denied verdict carries its matched statement id",
        any(v.matched_statement == "DenyDynamoDbCreate" for v in bad),
    )

    denied_err = AwsCliError(
        ["iam", "simulate-principal-policy"],
        254,
        "An error occurred (AccessDenied) when calling the SimulatePrincipalPolicy operation: ...",
    )
    check("AwsCliError recognizes AccessDenied for the fail-open path", denied_err.is_access_denied())
    other_err = AwsCliError(
        ["iam", "simulate-principal-policy"], 255, "An error occurred (ValidationError): bad action name"
    )
    check("AwsCliError does not misclassify unrelated errors as AccessDenied", not other_err.is_access_denied())

    # Drive main() itself through the fail-open and hard-fail branches, not
    # just the error-classification helper above: monkeypatch the module-level
    # run_aws so main()'s own try/except around each AWS call is what's under
    # test, exactly as it runs for real.
    original_run_aws = globals()["run_aws"]

    def run_main_with_fake_aws(
        sts_result: dict[str, Any] | Exception, simulate_result: dict[str, Any] | Exception
    ) -> int:
        def fake_run_aws(args: list[str]) -> dict[str, Any]:
            if args[:1] == ["sts"]:
                if isinstance(sts_result, Exception):
                    raise sts_result
                return sts_result
            if args[:1] == ["iam"]:
                if isinstance(simulate_result, Exception):
                    raise simulate_result
                return simulate_result
            raise AssertionError(f"unexpected aws call in self-test: {args}")

        globals()["run_aws"] = fake_run_aws
        try:
            with tempfile.TemporaryDirectory() as plan_dir:
                with open(os.path.join(plan_dir, "dev-example.json"), "w") as f:
                    json.dump(plan, f)
                return main(["--plan-dir", plan_dir])
        finally:
            globals()["run_aws"] = original_run_aws

    sts_denied_rc = run_main_with_fake_aws(
        AwsCliError(["sts", "get-caller-identity"], 254, "An error occurred (AccessDenied) ..."),
        {"EvaluationResults": []},
    )
    check("main() fails open (exit 0) when sts:GetCallerIdentity is denied", sts_denied_rc == 0)

    simulate_denied_rc = run_main_with_fake_aws(
        {"Account": account_id},
        AwsCliError(["iam", "simulate-principal-policy"], 254, "An error occurred (AccessDenied) ..."),
    )
    check("main() fails open (exit 0) when simulate-principal-policy is denied", simulate_denied_rc == 0)

    simulate_other_error_rc = run_main_with_fake_aws(
        {"Account": account_id},
        AwsCliError(["iam", "simulate-principal-policy"], 255, "An error occurred (ValidationError) ..."),
    )
    check(
        "main() hard-fails (exit 1), not fail-open, on a non-AccessDenied simulate error",
        simulate_other_error_rc == 1,
    )

    total = passed + len(failed)
    if failed:
        print(f"self-test: {passed}/{total} passed; FAILED: {', '.join(failed)}")
        return 1
    print(f"self-test: {passed}/{total} passed")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
