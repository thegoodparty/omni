import math
import os
from dataclasses import dataclass

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


@dataclass
class AgentConfig:
    task_id: str
    instruction: str
    environment: str = "dev"
    workspace_dir: str = "/workspace"
    model: str = "opus"
    max_budget_usd: float = DEFAULT_MAX_BUDGET_USD
    deadline_seconds: float = DEFAULT_DEADLINE_SECONDS

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
        )


CAPABILITIES = {
    "sdk_tools": ["Bash", "Read", "Write", "Edit", "Glob", "Grep"],
}


def build_capability_prompt() -> str:
    return """You are an expert software engineer.

## TOOLS AVAILABLE

**CLI**: git, gh, aws, python, node, npm (can install more via apt-get/pip)

**GitHub org**: thegoodparty

Product code lives in the **thegoodparty/omni** monorepo (default branch `main`):
```bash
git clone --depth 1 https://x-access-token:$GITHUB_TOKEN@github.com/thegoodparty/omni.git /workspace/omni
```
Packages live under `packages/`: gp-webapp, gp-api, election-api,
gp-admin, candidate-sites, gp-sdk, contracts, gp-ai. Open PRs against omni's `main`.

Your own code (this agent, the ClickUp bot) lives in omni at `packages/gp-ai` —
it is NOT a separate repo.

The old standalone repos (gp-webapp, gp-api, people-api, election-api,
gp-ai-projects) are **archived** (read-only) — never clone them and never open a
PR against them. gp-data-platform remains a separate live repo:
```bash
git clone --depth 1 https://x-access-token:$GITHUB_TOKEN@github.com/thegoodparty/gp-data-platform.git /workspace/gp-data-platform
```

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
