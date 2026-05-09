"""
generate_meeting_briefing.py — Generate a meeting briefing from an agenda PDF.

Reads agenda PDF, queries Haystaq constituent data from Databricks, calls
Anthropic to categorize agenda items and generate card content, then assembles
a structured briefing.json.

Loads credentials from:
  ~/Research/.env       — ANTHROPIC_API_KEY
  scripts/.env          — DATABRICKS_SERVER_HOSTNAME, DATABRICKS_HTTP_PATH, DATABRICKS_API_KEY

Usage:
    uv run python generate_meeting_briefing.py \\
        --pdf path/to/agenda.pdf \\
        --city chapel-hill-NC \\
        --date 2026-04-16 \\
        [--body "Chapel Hill Town Council"] \\
        [--output output/run-no-qa/]

Outputs to --output (default: output/<city>_<date>/):
    briefing.json         — structured meeting briefing
    claims.json           — per-claim source extracts (input for qa_validate.py)
    sources.json          — source registry (input for qa_validate.py)
    source_snapshots/     — raw extracted text from the agenda PDF
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from pydantic import BaseModel, Field


# ── Environment ───────────────────────────────────────────────────────────────

def _load_env() -> None:
    scripts_env = Path(__file__).resolve().parents[1] / ".env"
    research_env = Path(__file__).resolve().parents[3] / ".env"
    load_dotenv(scripts_env)
    load_dotenv(research_env, override=False)


# ── PDF extraction ────────────────────────────────────────────────────────────

def extract_pdf_text(pdf_path: Path, snapshots_dir: Path) -> str:
    """Extract full text from agenda PDF. Halts if text is empty (scanned PDF)."""
    try:
        import pdfplumber
    except ImportError:
        sys.exit("pdfplumber not installed. Run: uv add pdfplumber")

    pages = []
    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages):
            text = page.extract_text() or ""
            pages.append(f"[Page {i + 1}]\n{text}")

    full_text = "\n\n".join(pages).strip()
    if len(full_text) < 100:
        sys.exit(
            f"ERROR: PDF text extraction yielded fewer than 100 characters. "
            f"The file may be a scanned image and requires OCR. Path: {pdf_path}"
        )

    snapshot_path = snapshots_dir / "agenda_text.txt"
    snapshot_path.write_text(full_text, encoding="utf-8")
    print(f"  PDF extracted: {len(full_text):,} chars → {snapshot_path}")
    return full_text


# ── Anthropic client (minimal, tool-use based) ────────────────────────────────

class _AnthropicClient:
    def __init__(self, model: str = "claude-sonnet-4-6"):
        import anthropic
        key = os.getenv("ANTHROPIC_API_KEY")
        if not key:
            sys.exit("ERROR: ANTHROPIC_API_KEY not set. Add it to ~/Research/.env")
        self.model = model
        self._client = anthropic.Anthropic(api_key=key)

    def call(self, system: str, user: str, schema: type[BaseModel], max_tokens: int = 8096) -> BaseModel:
        import anthropic
        tool_def = {
            "name": "structured_output",
            "description": "Return the structured result.",
            "input_schema": schema.model_json_schema(),
        }
        for attempt in range(3):
            try:
                resp = self._client.messages.create(
                    model=self.model,
                    max_tokens=max_tokens,
                    system=system,
                    tools=[tool_def],
                    tool_choice={"type": "tool", "name": "structured_output"},
                    messages=[{"role": "user", "content": user}],
                )
                block = next((b for b in resp.content if b.type == "tool_use"), None)
                if block is None:
                    raise RuntimeError("No tool_use block in response")
                return schema.model_validate(block.input)
            except anthropic.RateLimitError:
                import time
                time.sleep(2 ** attempt)
        sys.exit("ERROR: Anthropic API failed after 3 attempts")


# ── Pass 1 schemas & logic ────────────────────────────────────────────────────

class AgendaItem(BaseModel):
    title: str = Field(description="Exact agenda item title as it appears in the document")
    item_number: str = Field(description="Agenda item number or identifier, e.g. '5B' or '12'")
    action_type: str = Field(description="One of: vote, discussion, presentation, consent, information, other")
    is_priority: bool = Field(description="True if this item involves a vote, major decision, or significant budget action")
    source_section: str = Field(description="Verbatim text from the PDF for this agenda item (up to 500 chars)")
    priority_reason: str = Field(description="One sentence explaining why this is or is not a priority item")


class Pass1Result(BaseModel):
    meeting_title: str = Field(description="Full meeting title as stated in the document")
    meeting_body: str = Field(description="Name of the governing body, e.g. 'Town Council'")
    meeting_time: str = Field(description="Meeting time as stated, e.g. '7:00 PM', or empty string if not found")
    total_items: int = Field(description="Total number of agenda items found")
    items: list[AgendaItem]


_PASS1_SYSTEM = """You are a civic meeting analyst. Extract structured information from a city council or municipal agenda document.

Rules:
- Extract every distinct agenda item you can identify.
- Copy item titles and source sections EXACTLY as they appear — do not paraphrase.
- Mark is_priority=true only for items requiring a vote, formal decision, contract approval, budget action, or public hearing.
- Consent calendar items that are grouped and routine should each be extracted but marked is_priority=false unless one is called out separately.
- Do not invent details not present in the document."""


def pass1_categorize(pdf_text: str, llm: _AnthropicClient) -> Pass1Result:
    prompt = f"Extract all agenda items from the following meeting agenda document.\n\n---\n{pdf_text}\n---"
    result = llm.call(_PASS1_SYSTEM, prompt, Pass1Result, max_tokens=8096)
    priority_count = sum(1 for item in result.items if item.is_priority)
    print(f"  Pass 1 done: {result.total_items} items found, {priority_count} priority")
    return result


# ── Haystaq constituent data ──────────────────────────────────────────────────

class HasytaqIssueMatch(BaseModel):
    hs_column: str = Field(description="The hs_* column name that best matches this agenda topic")
    issue_label: str = Field(description="Human-readable label for this issue, e.g. 'Public Safety Cameras'")
    confidence: str = Field(description="One of: high, medium, low")
    reasoning: str = Field(description="One sentence explaining the match")


class HasytaqMatchResult(BaseModel):
    matches: list[HasytaqIssueMatch]


def _query_databricks(sql: str) -> list[dict]:
    """Run a SQL query against Databricks and return rows as dicts."""
    from databricks.sql import connect
    conn = connect(
        server_hostname=os.environ["DATABRICKS_SERVER_HOSTNAME"],
        http_path=os.environ["DATABRICKS_HTTP_PATH"],
        access_token=os.environ["DATABRICKS_API_KEY"],
    )
    try:
        with conn.cursor() as cursor:
            cursor.execute(sql)
            cols = [d[0] for d in cursor.description]
            return [dict(zip(cols, row)) for row in cursor.fetchall()]
    finally:
        conn.close()


def _discover_hs_columns() -> list[str]:
    rows = _query_databricks(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_catalog = 'goodparty_data_catalog' "
        "  AND table_schema = 'dbt' "
        "  AND table_name = 'int__l2_nationwide_uniform_w_haystaq' "
        "  AND column_name LIKE 'hs_%' "
        "ORDER BY column_name LIMIT 300"
    )
    return [r["column_name"] for r in rows]


_HAYSTAQ_MATCH_SYSTEM = """You are a civic data analyst. Given a list of Haystaq voter-file issue columns and a set of agenda topics, identify which hs_* column best matches each topic.

Rules:
- Each hs_* column is a 0-100 continuous voter alignment score on a specific issue.
- Match agenda topics to columns by semantic relevance only — do not guess if no column fits.
- Return only matches with confidence medium or higher.
- Omit topics with no good match rather than returning a low-confidence guess."""


def query_haystaq(
    priority_items: list[AgendaItem],
    city: str,
    llm: _AnthropicClient,
) -> dict:
    """Find Haystaq columns relevant to agenda topics and query voter alignment scores."""
    if not priority_items:
        return {"available": False, "reason": "no priority items"}

    # Check Databricks credentials
    if not all(os.getenv(k) for k in ["DATABRICKS_SERVER_HOSTNAME", "DATABRICKS_HTTP_PATH", "DATABRICKS_API_KEY"]):
        print("  Haystaq: Databricks credentials not set — skipping constituent data")
        return {"available": False, "reason": "credentials_missing"}

    try:
        hs_columns = _discover_hs_columns()
        if not hs_columns:
            return {"available": False, "reason": "no_hs_columns_found"}
    except Exception as e:
        print(f"  Haystaq: column discovery failed ({e}) — skipping")
        return {"available": False, "reason": str(e)}

    topics = "\n".join(f"- {item.title}" for item in priority_items)
    columns_list = "\n".join(hs_columns[:200])
    prompt = (
        f"Agenda topics from a city council meeting in {city}:\n{topics}\n\n"
        f"Available Haystaq columns (0-100 voter alignment scores):\n{columns_list}"
    )

    try:
        matches = llm.call(_HAYSTAQ_MATCH_SYSTEM, prompt, HasytaqMatchResult, max_tokens=4096)
    except Exception as e:
        print(f"  Haystaq: column matching failed ({e}) — skipping")
        return {"available": False, "reason": str(e)}

    if not matches.matches:
        print("  Haystaq: no relevant columns matched to agenda topics")
        return {"available": False, "reason": "no_column_matches"}

    # Build voter count query for matched columns (city-wide scope)
    city_name = city.split("-")[0].replace("-", " ").title()
    state = city.split("-")[-1] if "-" in city else ""

    aggs = ", ".join(
        f"SUM(CASE WHEN `{m.hs_column}` >= 50 THEN 1 ELSE 0 END) AS `{m.hs_column}`"
        for m in matches.matches
        if m.hs_column in hs_columns
    )
    if not aggs:
        return {"available": False, "reason": "matched_columns_not_in_schema"}

    where_clauses = ["Voters_Active = 'A'"]
    if state:
        where_clauses.append(f"Residence_Addresses_State = '{state}'")
    if city_name:
        where_clauses.append(f"Residence_Addresses_City = '{city_name}'")
    where = " AND ".join(where_clauses)

    try:
        rows = _query_databricks(
            f"SELECT COUNT(*) AS total_active, {aggs} "
            f"FROM goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq "
            f"WHERE {where}"
        )
    except Exception as e:
        print(f"  Haystaq: voter query failed ({e}) — skipping")
        return {"available": False, "reason": str(e)}

    if not rows:
        return {"available": False, "reason": "empty_query_result"}

    row = rows[0]
    total = row.get("total_active", 0) or 0
    if total == 0:
        return {"available": False, "reason": "zero_voters_matched — check city/state spelling"}

    top_issues = []
    for m in matches.matches:
        col = m.hs_column
        if col not in row:
            continue
        count = row[col] or 0
        pct = round(count / total * 100, 1) if total else 0.0
        top_issues.append({
            "hs_column": col,
            "issue_label": m.issue_label,
            "aligned_voter_count": count,
            "aligned_voter_percentage": pct,
            "confidence": m.confidence,
        })

    top_issues.sort(key=lambda x: x["aligned_voter_percentage"], reverse=True)

    print(
        f"  Haystaq: {total:,} active voters, {len(top_issues)} matched issues"
        f" — top: {top_issues[0]['issue_label']} ({top_issues[0]['aligned_voter_percentage']}%)"
        if top_issues else f"  Haystaq: {total:,} active voters, 0 matched issues"
    )

    return {
        "available": True,
        "scope": "city-wide",
        "city": city_name,
        "state": state,
        "voter_count": total,
        "top_issues": top_issues,
        "provenance_note": (
            "Issue prioritization is based on modeled estimates of constituent sentiment "
            f"(Haystaq, city-wide scope: {city_name}{', ' + state if state else ''}). "
            "These are directional signals, not precise survey measurements."
        ),
    }


# ── Pass 2 schemas & logic ────────────────────────────────────────────────────

class SourceCitation(BaseModel):
    field: str = Field(description="Which field this citation supports, e.g. 'whatIsHappening'")
    quote: str = Field(description="Verbatim quote from the source document supporting this field")


class BriefingCard(BaseModel):
    what_is_happening: str = Field(description="2-3 sentence factual summary of what this agenda item is about")
    what_decision: str = Field(description="One sentence: what specific action or vote is being requested")
    why_it_matters: str = Field(description="2-3 sentences on relevance to residents and the council")
    budget_impact: str = Field(description="Budget figures if present, or empty string if not applicable")
    who_is_presenting: str = Field(description="Staff lead or presenter name/title, or empty string if not stated")
    source_citations: list[SourceCitation] = Field(description="Verbatim quotes from the agenda that support each field")


_PASS2_SYSTEM = """You are a civic briefing writer preparing summaries for a city council member.

Rules — SOURCE DISCIPLINE (mandatory):
- Every factual claim must be traceable to the provided agenda text.
- If a fact cannot be found in the agenda text, omit it entirely.
- Do not import background knowledge, plausible-sounding context, or general policy details not present in the text.
- Names, dollar amounts, dates, vote counts, and legal citations must be copied EXACTLY from the source — do not paraphrase or round.
- For each field you populate, provide a verbatim source_citation quote from the agenda text.

Rules — CONSTITUENT DATA:
- If constituent sentiment is provided, include it as a directional signal only.
- Always note that it is a modeled estimate, not a survey.
- If constituent data is unavailable for this item, omit the constituent section entirely.

Rules — VOICE:
- Write in an informative, factual register.
- Do not tell the council member what to do, how to vote, or what to say.
- Avoid scripted talking points."""


def pass2_generate_card(
    item: AgendaItem,
    pdf_text: str,
    constituent_issue: Optional[dict],
    llm: _AnthropicClient,
) -> BriefingCard:
    constituent_block = ""
    if constituent_issue:
        constituent_block = (
            f"\n\nConstituent sentiment data (modeled estimate, city-wide):\n"
            f"  Issue: {constituent_issue['issue_label']}\n"
            f"  Aligned voters: {constituent_issue['aligned_voter_count']:,} "
            f"({constituent_issue['aligned_voter_percentage']}% of active voters)\n"
            f"  Note: This is a directional model estimate, not a survey."
        )

    prompt = (
        f"Agenda item to summarize: {item.title} (Item {item.item_number})\n\n"
        f"Source text for this item:\n{item.source_section}\n\n"
        f"Full agenda document (for additional context if needed):\n{pdf_text[:6000]}"
        f"{constituent_block}"
    )
    return llm.call(_PASS2_SYSTEM, prompt, BriefingCard, max_tokens=4096)


# ── Assembly ──────────────────────────────────────────────────────────────────

def assemble_briefing(
    pass1: Pass1Result,
    city: str,
    date: str,
    cards: list[tuple[AgendaItem, BriefingCard]],
    constituent_data: dict,
    pdf_path: Path,
    snapshot_path: Path,
    run_ts: str,
) -> tuple[dict, list[dict], list[dict]]:
    """Return (briefing, claims, sources) as plain dicts."""
    city_name = city.split("-")[0].replace("-", " ").title()
    state = city.split("-")[-1] if "-" in city else ""

    source_id = "source_001"
    sources = [{
        "source_id": source_id,
        "source_type": "government_record",
        "title": pass1.meeting_title or f"Meeting Agenda {date}",
        "url": None,
        "retrieved_at": run_ts,
        "retrieval_method": "provided",
        "snapshot_path": str(snapshot_path),
        "publisher": pass1.meeting_body or city_name,
    }]

    priority_issues = []
    claims = []
    claim_counter = 1

    for item, card in cards:
        slug = item.title.lower().replace(" ", "-")[:50].strip("-")

        # Match constituent issue for this agenda item
        ci = None
        if constituent_data.get("available") and constituent_data.get("top_issues"):
            for issue in constituent_data["top_issues"]:
                if any(
                    word in item.title.lower()
                    for word in issue["issue_label"].lower().split()
                    if len(word) > 4
                ):
                    ci = issue
                    break

        source_sections = [{"label": f"Item {item.item_number}", "text": item.source_section}]

        detail = {
            "whatIsHappening": card.what_is_happening,
            "whatDecision": card.what_decision,
            "whyItMatters": card.why_it_matters,
            "budgetImpact": card.budget_impact,
            "whoIsPresenting": card.who_is_presenting,
        }

        source_citations = [
            {"field": c.field, "quote": c.quote}
            for c in card.source_citations
        ]

        priority_issues.append({
            "slug": slug,
            "agendaItemTitle": item.title,
            "itemNumber": item.item_number,
            "actionType": item.action_type,
            "detail": detail,
            "sourceCitations": source_citations,
            "sourceSections": source_sections,
            "constituentSentiment": {
                "available": ci is not None,
                "issue_label": ci["issue_label"] if ci else None,
                "aligned_voter_percentage": ci["aligned_voter_percentage"] if ci else None,
                "voter_count": constituent_data.get("voter_count") if ci else None,
                "provenance_note": constituent_data.get("provenance_note") if ci else None,
            } if constituent_data.get("available") else {"available": False},
        })

        # Emit claims for each populated text field
        field_claim_types = {
            "whatIsHappening": "background_context",
            "whatDecision": "vote_or_decision_fact",
            "whyItMatters": "background_context",
            "budgetImpact": "budget_number",
            "whoIsPresenting": "named_person_or_role",
        }
        for field, claim_type in field_claim_types.items():
            text = detail.get(field, "").strip()
            if not text:
                continue
            citation_quote = next(
                (c["quote"] for c in source_citations if c["field"] == field), ""
            )
            weight = (
                "high" if claim_type in {
                    "budget_number", "date_or_deadline", "legal_identifier",
                    "named_person_or_role", "vote_or_decision_fact", "meeting_logistics"
                } else "medium"
            )
            claims.append({
                "claim_id": f"claim_{claim_counter:03d}",
                "section_id": slug,
                "claim_text": text,
                "claim_type": claim_type,
                "claim_weight": weight,
                "citation_ids": [source_id],
                "source_extracts": [
                    {
                        "source_id": source_id,
                        "text": citation_quote,
                        "snapshot_path": str(snapshot_path),
                    }
                ] if citation_quote else [],
            })
            claim_counter += 1

    briefing = {
        "meeting": {
            "title": pass1.meeting_title,
            "date": date,
            "citySlug": city,
            "body": pass1.meeting_body,
            "time": pass1.meeting_time,
        },
        "executiveSummary": {
            "totalAgendaItems": pass1.total_items,
            "priorityItemCount": len(priority_issues),
        },
        "priorityIssues": priority_issues,
        "constituentData": constituent_data,
        "sources": sources,
        "generationProvider": "anthropic",
        "generationModel": "claude-sonnet-4-6",
        "generatedAt": run_ts,
    }

    return briefing, claims, sources


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pdf", required=True, help="Path to the agenda PDF")
    parser.add_argument("--city", required=True, help="City slug, e.g. chapel-hill-NC")
    parser.add_argument("--date", required=True, help="Meeting date YYYY-MM-DD")
    parser.add_argument("--body", default="", help="Governing body name (overrides PDF detection)")
    parser.add_argument("--output", default="", help="Output directory (default: output/<city>_<date>/)")
    args = parser.parse_args()

    _load_env()

    pdf_path = Path(args.pdf).resolve()
    if not pdf_path.exists():
        sys.exit(f"ERROR: PDF not found: {pdf_path}")

    output_dir = Path(args.output) if args.output else Path("output") / f"{args.city}_{args.date}"
    output_dir.mkdir(parents=True, exist_ok=True)
    snapshots_dir = output_dir / "source_snapshots"
    snapshots_dir.mkdir(exist_ok=True)

    run_ts = datetime.now(timezone.utc).isoformat()
    print(f"\n{'='*60}")
    print(f"MEETING BRIEFING — {args.city} {args.date}")
    print(f"{'='*60}")

    print("\n[1/4] Extracting PDF text...")
    pdf_text = extract_pdf_text(pdf_path, snapshots_dir)

    llm = _AnthropicClient()

    print("\n[2/4] Pass 1 — categorizing agenda items...")
    pass1 = pass1_categorize(pdf_text, llm)

    priority_items = [item for item in pass1.items if item.is_priority]
    if not priority_items:
        print("  WARNING: No priority items found — generating minimal briefing")
        priority_items = pass1.items[:3] if pass1.items else []

    print(f"\n[3/4] Querying Haystaq for {len(priority_items)} priority items...")
    constituent_data = query_haystaq(priority_items, args.city, llm)

    print(f"\n[4/4] Pass 2 — generating cards for {len(priority_items)} priority items...")
    cards: list[tuple[AgendaItem, BriefingCard]] = []
    for i, item in enumerate(priority_items):
        print(f"  [{i+1}/{len(priority_items)}] {item.title[:60]}")
        ci_match = None
        if constituent_data.get("available"):
            for issue in constituent_data.get("top_issues", []):
                if any(w in item.title.lower() for w in issue["issue_label"].lower().split() if len(w) > 4):
                    ci_match = issue
                    break
        card = pass2_generate_card(item, pdf_text, ci_match, llm)
        cards.append((item, card))

    snapshot_path = snapshots_dir / "agenda_text.txt"
    briefing, claims, sources = assemble_briefing(
        pass1, args.city, args.date, cards, constituent_data,
        pdf_path, snapshot_path, run_ts
    )

    if args.body:
        briefing["meeting"]["body"] = args.body

    (output_dir / "briefing.json").write_text(json.dumps(briefing, indent=2, ensure_ascii=False))
    (output_dir / "claims.json").write_text(json.dumps(claims, indent=2, ensure_ascii=False))
    (output_dir / "sources.json").write_text(json.dumps(sources, indent=2, ensure_ascii=False))

    print(f"\n{'='*60}")
    print(f"Done — {len(priority_items)} priority items, {len(claims)} claims")
    print(f"Output: {output_dir}/")
    print(f"  briefing.json    — meeting briefing")
    print(f"  claims.json      — {len(claims)} claims with source extracts")
    print(f"  sources.json     — source registry")
    print(f"  source_snapshots/ — raw agenda text")
    print(f"\nTo render as Markdown:")
    print(f"  uv run python briefing_to_pdf.py --briefing {output_dir}/briefing.json")
    print(f"\nTo run QA validation (requires qa-spine branch):")
    print(f"  uv run python qa_validate.py --output-dir {output_dir}/")


if __name__ == "__main__":
    main()
