"""Posts case scout alerts through the shared Slack notifier, reusing the
failures SNS topic the scaffold story's Terraform module already wires
(infrastructure/modules/case-scout's aws_sns_topic.failures ->
aws_sns_topic_subscription.shared_slack_notifier) — the same topic the
Lambda's own CloudWatch error-metric alarm and the Reader's ECS-task-failed
EventBridge rule already publish to. This module is the one way application
CODE (as opposed to an infra alarm) posts into that same pipe.

Top-level (not under reader/) on purpose: the Lambda zip
(infrastructure/modules/case-scout's archive_file) ships only this
package's top-level *.py files, and the `start` action's "no run in 36
hours" check (case_scout/health.py, called from lambda/handler.py) needs
this from inside the Lambda, not just from the Reader's Fargate container.

Pure stdlib + boto3 only — same constraint as every other top-level
case_scout module (see publisher.py's module docstring).
"""

import json
import os
from typing import Any

import boto3

TOPIC_ARN_ENV = "CASE_SCOUT_ALERTS_TOPIC_ARN"

_sns_client: Any = None


def _sns() -> Any:
    global _sns_client
    if _sns_client is None:
        _sns_client = boto3.client("sns")
    return _sns_client


def post_alert(environment: str, subject: str, message: str) -> bool:
    """Publishes one alert. Never raises — a failure to alert must not take
    down whatever pipeline step was already running when it happened (same
    never-crash-the-Lambda/Reader discipline every case_scout entry point
    keeps). Returns whether the publish succeeded, for callers/tests that
    want to know.

    The message shape mirrors the EventBridge input_transformer templates
    this same topic already receives from the infra-level alarms (an
    "alarm" field plus "environment"), so the shared Slack notifier sees one
    consistent shape whether an alert came from an infra event or from this
    function.
    """
    topic_arn = os.environ.get(TOPIC_ARN_ENV)
    if not topic_arn:
        print(f"ERROR: {TOPIC_ARN_ENV} not configured; dropping case scout alert: {subject}")
        return False
    try:
        _sns().publish(
            TopicArn=topic_arn,
            Subject=subject[:100],
            Message=json.dumps({"alarm": subject, "environment": environment, "detail": message}),
        )
        return True
    except Exception as e:
        print(f"ERROR: failed to publish case scout alert ({subject}): {type(e).__name__}: {e}")
        return False
