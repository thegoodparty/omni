"""report.html: the human grading sheet for one bench run. A local file,
opened in a browser, never published. Grades are exported as JSON from the
page and merged into results.json with `python -m case_scout.bench --grade`.
"""

import json
from html import escape
from typing import Any

GRADE_DIMENSIONS = (
    ("faithful", "Faithful", "The case tests the failure in the chat."),
    ("gradeable", "Gradeable", "One judge could apply the handled-when rule the same way twice."),
    ("fictional", "Fictional", "No real person, office or place."),
)

_STYLE = """
:root {
  --bg: #fafaf9; --panel: #ffffff; --text: #1c1917; --muted: #57534e; --line: #e7e5e4;
  --pass: #15803d; --fail: #b91c1c; --na: #78716c; --accent: #1d4ed8; --code: #f5f5f4;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1c1917; --panel: #292524; --text: #f5f5f4; --muted: #a8a29e; --line: #44403c;
    --pass: #4ade80; --fail: #f87171; --na: #a8a29e; --accent: #93c5fd; --code: #1c1917;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 1040px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 0 0 8px; }
h3 { font-size: 14px; margin: 16px 0 6px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
.muted { color: var(--muted); }
.banner { border: 1px solid var(--fail); color: var(--fail); padding: 8px 12px; border-radius: 6px; margin: 12px 0; }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 16px; margin: 16px 0; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
.table-wrap { overflow-x: auto; }
.pass { color: var(--pass); font-weight: 600; }
.fail { color: var(--fail); font-weight: 600; }
.na { color: var(--na); }
pre { background: var(--code); border: 1px solid var(--line); border-radius: 6px; padding: 10px; overflow-x: auto;
  white-space: pre-wrap; word-break: break-word; font-size: 13px; }
.grades { display: grid; gap: 10px; margin-top: 8px; }
.grade-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.grade-row strong { min-width: 90px; }
textarea { width: 100%; min-height: 48px; font: inherit; background: var(--bg); color: var(--text);
  border: 1px solid var(--line); border-radius: 6px; padding: 6px; }
button { font: inherit; padding: 8px 14px; border-radius: 6px; border: 1px solid var(--accent);
  background: var(--accent); color: var(--bg); cursor: pointer; }
a { color: var(--accent); }
"""

_SCRIPT = """
(() => {
  const data = JSON.parse(document.getElementById('bench-data').textContent)
  const key = 'case-scout-bench:' + data.runId
  const dims = ['faithful', 'gradeable', 'fictional']
  let saved = {}
  try { saved = JSON.parse(localStorage.getItem(key) || '{}') } catch (e) { saved = {} }

  const collect = () => {
    const grades = {}
    document.querySelectorAll('[data-grade-for]').forEach((block) => {
      const id = block.getAttribute('data-grade-for')
      const entry = { note: block.querySelector('textarea').value }
      dims.forEach((dim) => {
        const picked = block.querySelector('input[name="' + id + ':' + dim + '"]:checked')
        entry[dim] = picked ? Number(picked.value) : null
      })
      grades[id] = entry
    })
    return grades
  }

  document.querySelectorAll('[data-grade-for]').forEach((block) => {
    const id = block.getAttribute('data-grade-for')
    const prior = saved[id]
    if (!prior) return
    dims.forEach((dim) => {
      const input = block.querySelector('input[name="' + id + ':' + dim + '"][value="' + prior[dim] + '"]')
      if (input) input.checked = true
    })
    if (typeof prior.note === 'string') block.querySelector('textarea').value = prior.note
  })

  const save = () => {
    try { localStorage.setItem(key, JSON.stringify(collect())) } catch (e) {}
  }
  document.addEventListener('change', save)
  document.addEventListener('input', save)

  document.getElementById('export-grades').addEventListener('click', () => {
    const body = JSON.stringify({ runId: data.runId, grades: collect() }, null, 2)
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }))
    link.download = 'grades-' + data.runId + '.json'
    link.click()
  })
})()
"""


def _status(status: str) -> str:
    css = {"pass": "pass", "fail": "fail"}.get(status, "na")
    return f'<span class="{css}">{escape(status)}</span>'


def _expected(fixture: dict[str, Any]) -> str:
    expect = fixture["expect"]
    if not expect["scored"]:
        return "ignored (scope not covered)"
    if expect["covered_by"]:
        return f"skipped, covered by {expect['covered_by']}"
    if expect["should_draft"]:
        text = f"draft ({expect['pattern']})" if expect["pattern"] else "draft"
        return text + (", or dropped" if expect["drop_ok"] else "")
    return "no draft"


def _summary_table(fixtures: list[dict[str, Any]]) -> str:
    rows = []
    for f in fixtures:
        severity = f["score"]["severity"] if f["score"] else "-"
        failed = [name for name, c in f["checks"].items() if c["status"] == "fail"]
        rows.append(
            "<tr>"
            f'<td><a href="#{escape(f["id"])}">{escape(f["id"])}</a></td>'
            f"<td>{escape(f['agent'])}</td>"
            f"<td>{escape(f['category'])}</td>"
            f"<td>{escape(_expected(f))}</td>"
            f"<td>{escape(str(f['outcome'] or '-'))}</td>"
            f"<td>{escape(str(severity))}</td>"
            f"<td>{_status('pass' if f['passed'] else 'fail')}"
            f"{' ' + escape(', '.join(failed)) if failed else ''}</td>"
            "</tr>"
        )
    return (
        '<div class="table-wrap"><table><thead><tr><th>Fixture</th><th>Agent</th><th>Category</th>'
        "<th>Expected</th><th>Outcome</th><th>Severity</th><th>Checks</th></tr></thead><tbody>"
        + "".join(rows)
        + "</tbody></table></div>"
    )


def _grade_block(fixture: dict[str, Any]) -> str:
    fid = escape(fixture["id"])
    grades = fixture.get("grades") or {}
    rows = []
    for key, label, hint in GRADE_DIMENSIONS:
        options = "".join(
            f'<label><input type="radio" name="{fid}:{key}" value="{n}"'
            f"{' checked' if grades.get(key) == n else ''}> {n}</label>"
            for n in (1, 2, 3)
        )
        rows.append(
            f'<div class="grade-row"><strong>{label}</strong>{options}<span class="muted">{escape(hint)}</span></div>'
        )
    note = escape(grades.get("note") or "")
    return (
        f'<h3>Your grade</h3><div class="grades" data-grade-for="{fid}">'
        + "".join(rows)
        + f'<textarea placeholder="Note (optional)">{note}</textarea></div>'
    )


def _fixture_card(fixture: dict[str, Any]) -> str:
    parts = [
        f'<section class="panel" id="{escape(fixture["id"])}">',
        f"<h2>{escape(fixture['id'])}</h2>",
        f'<p class="muted">{escape(fixture["agent"])} · {escape(fixture["category"])} · '
        f"expected: {escape(_expected(fixture))}</p>",
        f"<p>{escape(fixture['summary'])}</p>",
    ]
    if fixture.get("notes"):
        parts.append(f'<p class="muted">{escape(fixture["notes"])}</p>')

    parts.append("<h3>Scout's score</h3>")
    if fixture["score"]:
        rows = "".join(
            f"<tr><td>{r['severity']}</td><td>{escape(r['knownPattern'])}</td>"
            f"<td>{escape(r['majorFailureType'])}</td><td>{escape(r['summary'])}</td>"
            f"<td>{escape(r['reason'])}</td></tr>"
            for r in fixture["score"]["requests"]
        )
        parts.append(
            '<div class="table-wrap"><table><thead><tr><th>Severity</th><th>Pattern</th><th>Failure</th>'
            f"<th>Ask</th><th>Reason</th></tr></thead><tbody>{rows}</tbody></table></div>"
        )
    else:
        parts.append(f'<p class="muted">{escape(fixture.get("scoringError") or "not scored")}</p>')

    draft = fixture.get("draftResponse")
    parts.append("<h3>Drafting</h3>")
    if draft:
        parts.append(
            f"<p>Outcome <strong>{escape(draft['outcome'])}</strong>"
            + (f", covered by <code>{escape(draft['coveredBy'])}</code>" if draft.get("coveredBy") else "")
            + (f", needs setup: {escape(draft['needsSetup'])}" if draft.get("needsSetup") else "")
            + f'. <span class="muted">Failure summary: {escape(draft["failureSummary"])}</span></p>'
        )
        if draft.get("case"):
            shown = fixture["case"] or draft["case"]
            parts.append(f"<pre>{escape(json.dumps(shown, indent=2, ensure_ascii=False))}</pre>")
    else:
        parts.append('<p class="muted">Not drafted (not a candidate).</p>')

    parts.append("<h3>Gate</h3>")
    gate = fixture.get("gate")
    if gate is None:
        parts.append('<p class="muted">Not reached.</p>')
    elif gate["passed"]:
        parts.append(f"<p>{_status('pass')}</p>")
    else:
        parts.append(f"<p>{_status('fail')} {escape(str(gate['rule']))}: {escape(str(gate['reason']))}</p>")

    checks = "".join(
        f"<tr><td>{escape(name)}</td><td>{_status(c['status'])}</td><td>{escape(c['detail'])}</td></tr>"
        for name, c in fixture["checks"].items()
    )
    parts.append(f'<h3>Automatic checks</h3><div class="table-wrap"><table><tbody>{checks}</tbody></table></div>')

    if fixture["case"]:
        parts.append(_grade_block(fixture))
    parts.append("</section>")
    return "".join(parts)


def render_report(results: dict[str, Any]) -> str:
    fixtures = results["fixtures"]
    summary = results["summary"]
    cost = results.get("cost") or {}
    data = json.dumps({"runId": results["runId"]}).replace("</", "<\\/")
    banner = (
        '<p class="banner">Stub run: every model answer came from the fixture labels. '
        "This checks the plumbing only and says nothing about the scout's quality.</p>"
        if results["mode"] == "stub"
        else ""
    )
    dims = "".join(f"<li><strong>{label}</strong>: {escape(hint)}</li>" for _, label, hint in GRADE_DIMENSIONS)
    return (
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width, initial-scale=1'>"
        f"<title>Case scout bench</title><style>{_STYLE}</style></head><body><main>"
        f"<h1>Case scout bench</h1><p class='muted'>Run {escape(results['runId'])} · {escape(results['mode'])} · "
        f"{escape(str(cost.get('model', '')))} · estimated ${cost.get('estimatedUsd', 0):.2f}</p>"
        f"{banner}"
        "<div class='panel'>"
        f"<p><strong>{summary['fixturesPassed']} of {summary['fixtures']}</strong> fixtures passed every automatic check. "
        f"{summary['drafts']} drafts reached the bundle.</p>"
        f"{_summary_table(fixtures)}</div>"
        "<div class='panel'><h2>Grading</h2><p>Grade every drafted case 1 to 3 on each line. "
        "3 is right, 2 is close, 1 is wrong.</p>"
        f"<ul>{dims}</ul>"
        "<p>Your choices are kept in this browser while you work. When you finish, export them and merge "
        f"them into results.json:</p><pre>uv run python -m case_scout.bench --grade {escape(results['outDir'])} "
        f"~/Downloads/grades-{escape(results['runId'])}.json</pre>"
        "<button id='export-grades' type='button'>Export grades</button></div>"
        + "".join(_fixture_card(f) for f in fixtures)
        + f"<script type='application/json' id='bench-data'>{data}</script><script>{_SCRIPT}</script>"
        "</main></body></html>"
    )
