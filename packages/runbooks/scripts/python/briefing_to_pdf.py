"""
briefing_to_pdf.py — Render a briefing.json as human-readable Markdown.

Usage:
    uv run python briefing_to_pdf.py --briefing output/run/briefing.json
    uv run python briefing_to_pdf.py --briefing output/run/briefing.json --output output/run/briefing.md

Writes a .md file alongside briefing.json by default.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def render(briefing: dict) -> str:
    lines: list[str] = []

    meeting = briefing.get("meeting", {})
    summary = briefing.get("executiveSummary", {})
    constituent = briefing.get("constituentData", {})

    lines += [
        f"# {meeting.get('title', 'Meeting Briefing')}",
        "",
        f"**{meeting.get('body', '')}** · {meeting.get('date', '')} · {meeting.get('time', '')}".strip(" ·"),
        "",
        f"*{summary.get('priorityItemCount', 0)} priority items · "
        f"{summary.get('totalAgendaItems', 0)} total agenda items*",
        "",
        "> *Briefings are AI-generated and still in beta, so double-check anything "
        "you'll act on against the sources. Your feedback shapes how we can improve "
        "our product moving forward.*",
        "",
        "---",
        "",
    ]

    for issue in briefing.get("priorityIssues", []):
        title = issue.get("agendaItemTitle", "")
        item_num = issue.get("itemNumber", "")
        action = issue.get("actionType", "")
        detail = issue.get("detail", {})
        sentiment = issue.get("constituentSentiment", {})

        lines += [
            f"## {title}",
            f"*Item {item_num} · {action}*" if item_num or action else "",
            "",
        ]

        if detail.get("whatIsHappening"):
            lines += [detail["whatIsHappening"], ""]

        if detail.get("whatDecision"):
            lines += [f"**Decision required:** {detail['whatDecision']}", ""]

        if detail.get("whyItMatters"):
            lines += [f"**Why it matters:** {detail['whyItMatters']}", ""]

        if detail.get("budgetImpact"):
            lines += [f"**Budget impact:** {detail['budgetImpact']}", ""]

        if detail.get("whoIsPresenting"):
            lines += [f"**Presenting:** {detail['whoIsPresenting']}", ""]

        if sentiment.get("available") and sentiment.get("aligned_voter_percentage") is not None:
            pct = sentiment["aligned_voter_percentage"]
            label = issue_label = sentiment.get("issue_label", "this issue")
            pnote = sentiment.get("provenance_note", "")
            lines += [
                f"**Constituent sentiment:** {pct}% of active voters aligned on {label}",
                f"*{pnote}*" if pnote else "",
                "",
            ]

        citations = issue.get("sourceCitations", [])
        if citations:
            lines += ["**Source citations:**", ""]
            for c in citations:
                lines += [f'> "{c["quote"]}"', f'*({c["field"]})*', ""]

        lines += ["---", ""]

    if constituent.get("available"):
        pnote = constituent.get("provenance_note", "")
        lines += [
            "## Constituent data",
            f"*{pnote}*" if pnote else "",
            "",
            f"Active voters in scope: {constituent.get('voter_count', 0):,}",
            "",
        ]
        for issue in constituent.get("top_issues", []):
            lines.append(
                f"- **{issue['issue_label']}**: {issue['aligned_voter_percentage']}% "
                f"({issue['aligned_voter_count']:,} voters)"
            )
        lines += ["", "---", ""]

    sources = briefing.get("sources", [])
    if sources:
        lines += ["## Sources", ""]
        for s in sources:
            title = s.get("title", s.get("source_id", ""))
            url = s.get("url")
            pub = s.get("publisher", "")
            lines.append(f"- {title}" + (f" — {pub}" if pub else "") + (f" [{url}]({url})" if url else ""))
        lines += [""]

    gen = briefing.get("generatedAt", "")
    provider = briefing.get("generationProvider", "")
    if gen or provider:
        lines += [f"*Generated {gen[:10]} via {provider}*", ""]

    return "\n".join(line for line in lines if line is not None)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--briefing", required=True, help="Path to briefing.json")
    parser.add_argument("--output", default="", help="Output .md path (default: alongside briefing.json)")
    args = parser.parse_args()

    briefing_path = Path(args.briefing)
    if not briefing_path.exists():
        sys.exit(f"ERROR: {briefing_path} not found")

    briefing = json.loads(briefing_path.read_text())
    md = render(briefing)

    out_path = Path(args.output) if args.output else briefing_path.with_suffix(".md")
    out_path.write_text(md, encoding="utf-8")
    print(f"Rendered → {out_path}")


if __name__ == "__main__":
    main()
