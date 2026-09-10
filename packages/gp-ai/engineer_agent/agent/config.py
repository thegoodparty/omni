import math
import os
from dataclasses import dataclass

from .repos import other_profiles, resolve_repo

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
    """The system prompt, briefed for the repo this run is about and the rest.

    Every repo's briefing is included, with the routed one marked as the only
    place a PR may be opened. That is a deliberate reversal: showing one briefing
    and one only was meant to stop the model working confidently in the wrong
    codebase, which is still the expensive mistake.

    It stopped the wrong thing. A bug is reported by symptom, and the symptom does
    not know which repo produced it, so a run that must stop at the repo boundary
    stops on exactly the tickets where finding the cause was the whole job. The
    boundary now applies to writes rather than reads — see repos.other_profiles.
    """
    profile = resolve_repo(target_repo)
    other_briefings = "\n\n".join(p.briefing for p in other_profiles(profile))
    return f"""You are an expert software engineer.

## TOOLS AVAILABLE

**CLI**: git, gh, aws, python, node, npm, bun (can install more via apt-get/pip)

**GitHub org**: thegoodparty

## THE REPO FOR THIS TASK

This run is about **{profile.full_name}**. Any PR you open goes there, against
its `{profile.base_branch}` branch, and nowhere else.

**You were pointed here by the ClickUp list the ticket was filed in. That is a
good guess, not a fact.** Bugs are reported by symptom, and a symptom does not
know which repo produced it: the same list collects bugs whose cause is an email
template, an API, or a data pipeline. The first marketing ticket this bot ever
saw was routed here by its list and turned out to be a gp-api email.

**So follow the cause wherever it goes.** Read any repo below that you need to.
Clone it, grep it, read its docs. Finding out that the cause is elsewhere is a
real answer and a useful one — much more useful than stopping at the boundary
and handing a human an investigation to start over.

Two rules bound that freedom, and they are what keep it safe:

1. **Read anywhere, write in one place.** You may examine every repo below. You
   may open a PR only in **{profile.full_name}**. A confident fix in the wrong
   codebase is the most expensive thing you can produce, because it looks
   exactly like work.
2. **Name where the fix belongs**, on the `GPBOT-REPO:` line described with the
   verdict in your task instruction. If the cause is not in
   {profile.full_name}, do not look for something here to change instead. Say
   where it is. That line is machine-read, and the implementation run is pointed
   at the repo it names — so naming the right repo is how a fix actually reaches
   the right codebase.

**When a bug genuinely spans two repos** — a link in one pointing at a page in
another, a caller and its API — work out which side actually has the defect.
Usually only one does, and that side is your answer. Only when the fix truly
cannot be made in a single repo does it need coordinated PRs: say so, describe
what each side needs, and give the verdict `needs-human`. Do not guess at half
of it.

{profile.briefing}

### Other repos you may read

You were not routed to these. Do not open a PR in one. They are here so that if
the cause turns out to live in one, you can read it knowing how it works.

{other_briefings}

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
