"""Generate short, personalized "abridged campaign plan" blurbs for a list of
contacts, for a marketing re-engagement test.

This is a deliberately standalone, fake-it-till-we-make-it tool. It does NOT
touch the production campaign-plan engine (gp-api campaignStrategy / CAP agents),
which is keyed by campaign id and needs a fully onboarded campaign (BallotReady
race id, election date, race metrics). These contacts have none of that: they
raised a hand but never finished account creation. So we generate a lightweight
teaser from whatever HubSpot already knows about them (name, location, office
interest) with a single Claude call each.

Input: a CSV with at least a name column and a location column; an office column
is optional. Any other columns (email, hubspot id, ...) are passed through
untouched so the result merges straight back into HubSpot.

Output: the input rows plus `plan_headline`, `plan_body`, and `plan_json`
columns. `plan_body` is ready to drop into a marketing email; `plan_json` keeps
the structured pieces if marketing wants to lay them out differently.

Usage:
    export ANTHROPIC_API_KEY=...            # or put it in scripts/.env
    uv run abridged_campaign_plan.py --input contacts.csv --output plans.csv
    uv run abridged_campaign_plan.py --input contacts.csv --limit 5 --dry-run

Cost: one Claude Sonnet call per contact. ~100 contacts is a few cents total and
runs in about a minute at the default concurrency.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from dotenv import load_dotenv
from pydantic import BaseModel, Field

# Match the model gp-api already uses for candidate-facing AI content. Override
# with --model or the AI_MODEL env var if you want to trade cost for quality.
DEFAULT_MODEL = "claude-sonnet-4-6"

# Rough Sonnet pricing ($/million tokens) for the cost estimate line only. Not
# billing-authoritative — just so a run tells you the ballpark spend.
PRICE_PER_MTOK_INPUT = 3.0
PRICE_PER_MTOK_OUTPUT = 15.0

# Column-name candidates we recognize, case-insensitive. First match wins.
NAME_COLUMNS = ("name", "full_name", "fullname", "first_name", "firstname", "contact")
LOCATION_COLUMNS = ("location", "city_state", "city", "town", "municipality", "place", "district")
OFFICE_COLUMNS = ("office", "office_name", "seat", "position", "race", "office_interest")

SYSTEM_PROMPT = """\
You write short, personalized re-engagement blurbs for GoodParty.org, a \
nonpartisan civic-tech nonprofit that helps everyday people run for local office \
as independents, free of party and donor influence.

The reader is a person who once showed interest in running but never finished \
signing up. This blurb is a teaser of the "campaign plan" our product would build \
for them. The goal is to make running feel concrete and winnable, and to pull \
them back to finish setting up their plan. It is a marketing email, not the real \
plan.

Rules:
- Plain, direct U.S. English. Warm and encouraging, never hype.
- Do NOT use em dashes. Do NOT use emoji.
- Keep it tight: the body is 90 to 140 words.
- You know only the reader's name, rough location, and (maybe) the office they \
were interested in. Do NOT invent specific numbers such as win numbers, voter \
counts, turnout, budgets, or dates. Speak to the approach, not fake figures. If \
you gesture at a metric, frame it as something their plan will calculate for \
them, not a known value.
- Nonpartisan. Never assume or imply a party, ideology, or policy position.
- Speak to the reader as "you". Refer to them by first name at most once.
- The next step is a soft nudge to come back and finish their free campaign plan. \
No fake urgency, no pressure.
"""

USER_TEMPLATE = """\
Write an abridged campaign-plan teaser for this contact.

Name: {name}
Location: {location}
Office they were interested in: {office}

If a field says "unknown", write around it gracefully rather than calling it out.
Return your answer by calling the emit_plan tool.
"""

EMIT_PLAN_TOOL = {
    "name": "emit_plan",
    "description": "Emit the abridged campaign-plan teaser for one contact.",
    "input_schema": {
        "type": "object",
        "properties": {
            "headline": {
                "type": "string",
                "description": "A short, specific subject-line-style headline, under 70 characters.",
            },
            "body": {
                "type": "string",
                "description": "The 90-140 word email body, plain text, ready to send.",
            },
            "snapshot": {
                "type": "array",
                "items": {"type": "string"},
                "description": "2 to 4 very short strategic-highlight bullets (each under 12 words).",
            },
            "next_step": {
                "type": "string",
                "description": "One-sentence soft call to action to finish their free campaign plan.",
            },
        },
        "required": ["headline", "body", "snapshot", "next_step"],
    },
}


class AbridgedPlan(BaseModel):
    headline: str
    body: str
    snapshot: list[str] = Field(default_factory=list)
    next_step: str


def pick_column(fieldnames: list[str], candidates: tuple[str, ...]) -> str | None:
    lowered = {f.lower().strip(): f for f in fieldnames}
    for cand in candidates:
        if cand in lowered:
            return lowered[cand]
    return None


def read_contacts(path: Path) -> tuple[list[dict], list[str], dict[str, str | None]]:
    with path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        if not reader.fieldnames:
            raise ValueError("input CSV has no header row")
        fieldnames = list(reader.fieldnames)
        rows = [dict(r) for r in reader]
    mapping = {
        "name": pick_column(fieldnames, NAME_COLUMNS),
        "location": pick_column(fieldnames, LOCATION_COLUMNS),
        "office": pick_column(fieldnames, OFFICE_COLUMNS),
    }
    if not mapping["name"]:
        raise ValueError(
            f"could not find a name column; looked for {NAME_COLUMNS}, "
            f"got headers {fieldnames}"
        )
    if not mapping["location"]:
        raise ValueError(
            f"could not find a location column; looked for {LOCATION_COLUMNS}, "
            f"got headers {fieldnames}"
        )
    return rows, fieldnames, mapping


def make_client():
    import anthropic

    return anthropic.Anthropic()


def generate_one(client, model: str, row: dict, mapping: dict[str, str | None]):
    name = (row.get(mapping["name"]) or "").strip() or "there"
    location = (row.get(mapping["location"]) or "").strip() or "unknown"
    office_col = mapping["office"]
    office = (row.get(office_col) or "").strip() if office_col else ""
    office = office or "unknown"

    resp = client.messages.create(
        model=model,
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        tools=[EMIT_PLAN_TOOL],
        tool_choice={"type": "tool", "name": EMIT_PLAN_TOOL["name"]},
        messages=[
            {
                "role": "user",
                "content": USER_TEMPLATE.format(
                    name=name, location=location, office=office
                ),
            }
        ],
    )
    block = next((b for b in resp.content if getattr(b, "type", None) == "tool_use"), None)
    if block is None:
        raise RuntimeError("no tool_use block in response")
    plan = AbridgedPlan.model_validate(block.input)
    usage = (resp.usage.input_tokens, resp.usage.output_tokens)
    return plan, usage


def render_body(plan: AbridgedPlan) -> str:
    parts = [plan.body.strip()]
    if plan.snapshot:
        parts.append("")
        parts.extend(f"- {s.strip()}" for s in plan.snapshot)
    parts.append("")
    parts.append(plan.next_step.strip())
    return "\n".join(parts)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="input CSV of contacts")
    parser.add_argument("--output", type=Path, help="output CSV (default: <input>.plans.csv)")
    parser.add_argument("--model", default=os.environ.get("AI_MODEL", DEFAULT_MODEL))
    parser.add_argument("--limit", type=int, default=0, help="only process the first N rows")
    parser.add_argument("--workers", type=int, default=4, help="concurrent Claude calls")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="print the first row's resolved prompt and exit without calling Claude",
    )
    args = parser.parse_args()

    load_dotenv()  # picks up scripts/.env at runtime; safe if absent

    rows, fieldnames, mapping = read_contacts(args.input)
    if args.limit:
        rows = rows[: args.limit]
    print(
        f"Loaded {len(rows)} contacts. Columns: name={mapping['name']!r} "
        f"location={mapping['location']!r} office={mapping['office']!r}",
        file=sys.stderr,
    )

    if args.dry_run:
        if not rows:
            print("no rows to preview", file=sys.stderr)
            return 0
        r = rows[0]
        office_col = mapping["office"]
        preview = USER_TEMPLATE.format(
            name=(r.get(mapping["name"]) or "").strip() or "there",
            location=(r.get(mapping["location"]) or "").strip() or "unknown",
            office=((r.get(office_col) or "").strip() if office_col else "") or "unknown",
        )
        print("--- SYSTEM ---\n" + SYSTEM_PROMPT)
        print("--- USER (row 1) ---\n" + preview)
        print(f"--- MODEL ---\n{args.model}")
        return 0

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY is not set (env or scripts/.env)", file=sys.stderr)
        return 2

    client = make_client()

    def work(indexed):
        i, row = indexed
        try:
            plan, usage = generate_one(client, args.model, row, mapping)
            return i, plan, usage, None
        except Exception as exc:  # noqa: BLE001 - one bad row must not kill the batch
            return i, None, (0, 0), str(exc)

    results: list = [None] * len(rows)
    tok_in = tok_out = 0
    failures = 0
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        for done, (i, plan, usage, err) in enumerate(
            pool.map(work, list(enumerate(rows))), start=1
        ):
            results[i] = (plan, err)
            tok_in += usage[0]
            tok_out += usage[1]
            if err:
                failures += 1
                print(f"  [{done}/{len(rows)}] row {i} FAILED: {err}", file=sys.stderr)
            else:
                print(f"  [{done}/{len(rows)}] row {i} ok", file=sys.stderr)

    out_path = args.output or args.input.with_suffix(".plans.csv")
    out_fields = fieldnames + ["plan_headline", "plan_body", "plan_json"]
    with out_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=out_fields)
        writer.writeheader()
        for row, (plan, err) in zip(rows, results):
            out = dict(row)
            if plan is None:
                out["plan_headline"] = ""
                out["plan_body"] = ""
                out["plan_json"] = json.dumps({"error": err})
            else:
                out["plan_headline"] = plan.headline
                out["plan_body"] = render_body(plan)
                out["plan_json"] = plan.model_dump_json()
            writer.writerow(out)

    est_cost = (
        tok_in / 1_000_000 * PRICE_PER_MTOK_INPUT
        + tok_out / 1_000_000 * PRICE_PER_MTOK_OUTPUT
    )
    print(
        f"\nWrote {len(rows)} rows to {out_path} "
        f"({failures} failed). Tokens in/out: {tok_in}/{tok_out}. "
        f"Est. cost: ${est_cost:.2f}",
        file=sys.stderr,
    )
    return 1 if failures == len(rows) and rows else 0


if __name__ == "__main__":
    raise SystemExit(main())
