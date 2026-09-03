import math
import os
from dataclasses import dataclass

from .repos import resolve_repo

BOT_PREFIX = "[GP-Bot]"

# Per-run ceilings. Until now a run had neither: max_turns=200 on Opus with no
# budget and no clock, which was survivable while a human hand-applied
# gpbot-work one ticket at a time. Every bug reported now launches a run
# automatically, so an unbounded worst case is no longer a worst case anyone
# would notice — it is a recurring bill.
#
# Both are ceilings, not targets. A normal fix lands far under either; these
# exist to bound the pathological run that has stopped making progress and is
# re-reading the same files.
DEFAULT_MAX_BUDGET_USD = 15.0
DEFAULT_DEADLINE_SECONDS = 45 * 60


def _positive_float_from_env(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        value = None
    # isfinite + positive, not just "float() parsed": float() accepts
    # 'nan'/'inf', and either would silently disable the ceiling it was set to
    # enforce — NaN because every comparison against it is False, inf because
    # nothing exceeds it. A typo must fall back to the default loudly enough to
    # find in the log, not quietly remove the guard rail.
    if value is not None and math.isfinite(value) and value > 0:
        return value
    print(f"Invalid {name} env value; using default {default}")
    return default


ANALYZE_LABEL = "analyze"


@dataclass
class AgentConfig:
    task_id: str
    instruction: str
    environment: str = "dev"
    workspace_dir: str = "/workspace"
    model: str = "opus"
    max_budget_usd: float = DEFAULT_MAX_BUDGET_USD
    deadline_seconds: float = DEFAULT_DEADLINE_SECONDS
    # Which kind of run this is ("analyze" / "implement"), set by the ClickUp
    # bot's container override. Defaults to empty rather than to "analyze": an
    # unset label means we are running somewhere that does not set it (a local
    # invocation, an older task definition), and the escalation path must stay
    # closed in that case rather than treating an unknown run as an analysis
    # allowed to queue implementation work.
    label: str = ""
    # Which repo this run is about, set by the ClickUp bot's container override
    # from the ticket's list. Empty means nobody routed — a local run, or a task
    # definition from before multi-repo — and resolve_repo() reads that as omni,
    # which is what every such run meant before this field existed.
    target_repo: str = ""

    @classmethod
    def from_env(cls) -> "AgentConfig":
        return cls(
            task_id=os.environ.get("TASK_ID", os.environ.get("CLICKUP_TASK_ID", "")),
            instruction=os.environ.get("INSTRUCTION", ""),
            environment=os.environ.get("ENVIRONMENT", "dev"),
            workspace_dir=os.environ.get("WORKSPACE_DIR", "/workspace"),
            model=os.environ.get("AGENT_MODEL", "opus"),
            max_budget_usd=_positive_float_from_env("AGENT_MAX_BUDGET_USD", DEFAULT_MAX_BUDGET_USD),
            deadline_seconds=_positive_float_from_env("AGENT_DEADLINE_SECONDS", DEFAULT_DEADLINE_SECONDS),
            label=os.environ.get("AGENT_LABEL", ""),
            target_repo=os.environ.get("TARGET_REPO", ""),
        )


CAPABILITIES = {
    "sdk_tools": ["Bash", "Read", "Write", "Edit", "Glob", "Grep"],
}


def build_capability_prompt(target_repo: str | None = None) -> str:
    """The system prompt, briefed for the one repo this run is about.

    Only the target repo's briefing is included. Handing the model every repo it
    could theoretically touch and trusting it to pick invites exactly the mistake
    that is most expensive here — working confidently in the wrong codebase.
    """
    profile = resolve_repo(target_repo)
    return f"""You are an expert software engineer.

## TOOLS AVAILABLE

**CLI**: git, gh, aws, python, node, npm, bun (can install more via apt-get/pip)

**GitHub org**: thegoodparty

## THE REPO FOR THIS TASK

This run is about **{profile.full_name}**. Work in that repo and no other, and
open any PR against its `{profile.base_branch}` branch.

**If the bug is not in this repo, say so and stop.** You were pointed here by
the ClickUp list the ticket was filed in. That is a good guess, not a fact: the
same list collects bugs whose code lives elsewhere — an email template, an API,
a data pipeline. If the behaviour described is produced by code in another repo,
give the verdict `needs-human`, name the repo you believe it belongs in, and say
what evidence pointed you there. Do not go looking for something in this repo to
change instead. A confident fix in the wrong codebase is the most expensive
thing you can produce here, because it looks exactly like work.

{profile.briefing}

**Databricks** (read-only): `python -m engineer_agent.scripts.query_db --help`
Default catalog: goodparty_data_catalog.dbt

**CloudWatch**: aws logs cli

**ClickUp**:
- Post comments: `python -m engineer_agent.scripts.post_to_clickup --task-id <id> --comment "message"`
- Get task details: `ClickUpClient().get_task(task_id)` returns `ClickUpTask` with `.custom_id` (e.g. ENG-1234) and `.get_branch_prefix()`
- Search docs / read threads: use shared.clickup_client.ClickUpClient
- Workspace ID: 90132012119

**Slack**: use shared.slack_client.SlackClient to read threads by URL

## OUTPUT

Post your findings to ClickUp with the [GP-Bot] prefix.
"""
