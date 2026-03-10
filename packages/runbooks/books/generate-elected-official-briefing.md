Generate a comprehensive briefing document for a newly elected independent official — covering constituent data, local government context, and a transition roadmap for their first 90 days.

## Prerequisites

**books/.env variables**: `$AWS_PROFILE`
**scripts/.env variables**: `DATABRICKS_API_KEY`, `DATABRICKS_SERVER_HOSTNAME`, `DATABRICKS_HTTP_PATH`
**Tools**: `uv` (install: `curl -LsSf https://astral.sh/uv/install.sh | sh`), `python 3.12+`
**Setup**: `cd scripts/python && uv sync`

## Steps

1. **Run constituent data queries** — gather demographics, issue scores, and zip-level breakdown (see [Data Queries](#data-queries))
2. **Research local government** — find meeting minutes, budget docs, and news from the past 6 months (see [Research Methodology](#research-methodology))
3. **Generate the briefing** — write all 8 sections using the V2 structure (see [Briefing Structure](#briefing-structure-v2))
4. **Add polling opportunities** — identify 3–5 spots where Good Party polling adds value (see [Polling Integration](#polling-integration))
5. **Quality check** — verify against the checklist before delivering (see [Quality Checklist](#quality-checklist))
6. **Generate PDF** — format using ReportLab (see [PDF Formatting](#pdf-formatting))

---

## Data Queries

All scripts are in `scripts/python/`. Run from that directory with `$AWS_PROFILE` set.

```bash
cd scripts/python
export AWS_PROFILE=$AWS_PROFILE
```

### Query 1: Demographics

```bash
uv run query_demographics.py CHARLOTTE nc
```

Returns: total voters, party breakdown, average age, gender split.

### Query 2: Issue Scores (Local/State Only)

```bash
uv run query_issue_scores.py CHARLOTTE nc
```

Returns: average Haystaq scores (0–100) for housing, public safety, infrastructure, environment, education, economics, taxes, and ideology. **Only includes issues within local/state authority — excludes federal issues (healthcare, abortion, federal immigration, etc.).**

### Query 3: Breakdown by Zip (optional)

```bash
uv run query_by_zip.py CHARLOTTE nc
```

Returns: top issues segmented by zip code. Useful for district-based elections.

### Interpreting Scores

| Tier | Score Range | Meaning |
|------|-------------|---------|
| Tier 1 | 75+ | Very strong constituent concern |
| Tier 2 | 60–74 | Strong concern |
| Tier 3 | 50–59 | Moderate concern |
| Below 50 | <50 | Lower priority or opposition |

**Tips:**
- Always `CAST(s.column AS DOUBLE)` when using `AVG()` on score columns
- Use `SELECT * ... LIMIT 1` to explore all available column names for a state
- Look for gaps between scores to identify clear priorities vs. contested issues
- Before including any issue, confirm the official has actual authority over it

---

## Briefing Structure (V2)

### Your Role

You are an expert chief of staff and policy analyst. Your briefings help officials transition into their role effectively, understand constituent priorities through data, and identify immediate early win opportunities.

### What You'll Receive from the User

1. **Official's name**
2. **Office/position** (e.g., City Council Member, Mayor, County Commissioner)
3. **Location** (city/county and state)
4. **Constituent data** (optional — use the queries above if not provided)

### V2 Structure Overview

Generate an 8-section briefing optimized for transition and quick wins. Each section should be **one page maximum**.

| # | Section | Purpose |
|---|---------|---------|
| 1 | Executive Summary | Transition-focused, top 3–4 priorities |
| 2 | Lessons Learned From Recent History | Immediate context from past 6 months |
| 3 | Quick Wins | 3–5 specific, achievable first-90-day actions |
| 4 | Your Constituents' Top Issues | Haystaq data — what they actually care about |
| 5 | What to Watch & Prepare For | Forward orientation, upcoming decisions |
| 6 | Understanding This Role | Scope, boundaries, how to represent the community |
| 7 | Top 3 Budget Discussions | Recent context with inline citations |
| 8 | Top 3 Non-Budget Policy Discussions | Recent context with inline citations |
| Appendix | Key Resources | One-page reference list |

---

### Section 1: Executive Summary (Transition-Focused)

**Keep to 2 short paragraphs maximum. Write directly TO the official in second person.**

**Paragraph 1 — The Situation** (3–4 sentences):
- What they're inheriting (tone of recent discussions, major pending issues)
- Top 2–3 constituent priorities from Haystaq (with scores)
- One defining challenge or opportunity for this moment

**Paragraph 2 — First 90 Days: Top 3–4 Focus Areas** (4–5 sentences):
- Each focus area should be actionable and tie to both constituent data AND recent context
- Be specific (e.g., "champion the UDO amendments on Feb 16" not "focus on housing")

**Do NOT:**
- Include quick wins here (they have their own section)
- Say "This briefing provides…" or "You are a…"
- Go beyond 2 paragraphs

---

### Section 2: Lessons Learned From Recent History

**Format: Numbered list of top 5 lessons. One page max.**

Each lesson: 2–3 sentences, references a specific recent event, provides actionable insight.

---

### Section 3: Quick Wins

**Format: Numbered list of 3–5 items. One page max.**

Each quick win:
- Achievable within 90 days
- Visible to constituents
- Directly addresses a top Haystaq priority
- Requires minimal budget
- Includes specific action steps with dates where possible

Good examples: champion a specific upcoming vote, create a public progress dashboard, convene a stakeholder meeting, introduce an ordinance, launch a community poll.

**Include 1–2 Good Party polling opportunities here** (see [Polling Integration](#polling-integration)).

---

### Section 4: Your Constituents' Top Issues

**Use only Haystaq data from the queries. One page max.**

Structure:
1. **Opening** (2–3 sentences): state the data source and total voters analyzed — no editorializing
2. **Demographics at a Glance** (table): total voters, average age, gender split. Do NOT include party breakdown — the official represents everyone.
3. **Top 10 Issues by Priority** (table): rank, issue name, score, color-coded tier

⚠️ **Only include issues within local/state authority.** No federal issues.

Keep it clean: brief intro, demographics table, issues table. No extra subsections or analysis.

**Include 1–2 Good Party polling opportunities** when Haystaq scores are in the 45–55 range (unclear direction) or when top issues need specific policy direction.

---

### Section 5: What to Watch & Prepare For

**3 items max per subsection. One page max.**

- **Issues Requiring Immediate Attention**: items from recent meetings needing follow-up soon — be specific about timing
- **Political Dynamics to Understand**: council relationships, voting patterns, key alliances, stakeholder dynamics
- **Upcoming Challenges or Decisions**: major votes, budget decisions, or discussions requiring preparation

**Include 1–2 Good Party polling opportunities** tied to specific upcoming meetings or votes.

---

### Section 6: Understanding This Role

**One page max.**

- **What Is Expected**: explain the policy-making vs. operational distinction for their form of government (council-manager, strong mayor, commission, etc.). 3–4 paragraphs max.
- **What Is Outside the Scope**: clarify what they should NOT do — not an ombudsman, project manager, or department supervisor. 2–3 paragraphs max.
- **How to Represent Your Community**: balancing constituent interests with the broader good, using data to avoid the vocal minority trap, coalition-building, transparent communication, when to poll (tie to Good Party). 2–3 paragraphs max.

---

### Section 7: Top 3 Budget Discussions (Past 6 Months)

**3 discussions max. One page max. Condensed format.**

For each:
- **Title & Date** (one line)
- **Critical Discussion Points**: 3–5 bullets with **inline citations** — format: `Point ([Source Title, Date](URL))`
- **Outcome**: one sentence with inline citation
- **Why This Matters for You**: 1–2 sentences connecting to current priorities or upcoming decisions

Focus on: revenue/spending decisions, contentious votes, fund balance and debt, tradeoffs that reveal values.

**Include polling opportunities** when upcoming similar decisions could benefit from constituent input.

---

### Section 8: Top 3 Non-Budget Policy Discussions (Past 6 Months)

Same format as Section 7.

Focus on: major policy changes, development/zoning controversies, infrastructure projects, issues with strong public engagement.

---

### Appendix: Key Resources

**One page, no section headings.**

Simple list: meeting schedule & location, city/county manager name and contact, 3–4 key department heads with contacts, budget website URL, meeting archives URL, key budget numbers (total budget, tax rate, fund balance), official contact info for the office.

---

## Polling Integration

These briefings are delivered to elected officials who work with Good Party, which offers constituent polling services.

### When to Suggest Polling

1. **Before major votes** — upcoming council votes, budget decisions, zoning changes with unclear constituent support
2. **When data is dated or uncertain** — Haystaq data is 6+ months old or new issues have emerged
3. **When constituents are split** — Haystaq scores in the 45–55 range, divided public comment
4. **To validate bold moves** — official wants to pursue a policy that differs from past council approach
5. **For community engagement** — low trust in government, recent backlash, building support for future initiatives

### Polling Callout Format

```
📊 **GOOD PARTY POLLING OPPORTUNITY**

**Issue:** [Brief description]
**Timing:** [When to poll — before specific meeting/vote]
**Key Questions:**
- [Specific question 1]
- [Specific question 2]
- [Specific question 3]

**Why This Matters:** [1–2 sentences on what decision this informs]
**Action:** Contact Good Party to set up a community poll before [specific date/event].
```

### Guidelines

- Be specific about timing — "poll before the February 16 vote" not "consider polling"
- Tie every poll to a specific meeting, decision, or deadline
- Make questions actionable — they should inform a specific decision
- Include 3–5 polling opportunities per briefing, not more
- Prioritize polls where results would genuinely change outcomes

---

## Research Methodology

### Primary Sources
- Official government meeting agendas, minutes, and staff reports
- Budget documents and presentations
- Official press releases
- Meeting videos/transcripts if available

### Secondary Sources
- Local newspaper coverage
- Public radio coverage
- Regional news outlets
- Government transparency sites (e.g., CitizenPortal.ai)

### What NOT to Use
- Social media posts (context only, not as facts)
- Advocacy organization claims (acknowledge views, verify independently)
- Blogs or opinion pieces

### Research Steps

1. Find the official government website and meeting archives
2. Identify the most recent 6 months with complete records
3. Find top 3 budget discussions (work sessions, public hearings, adoption meetings)
4. Find top 3 non-budget policy discussions (look for: zoning, infrastructure, controversies, high public engagement)
5. Identify key players: council members, city/county manager, key department heads, vocal community advocates
6. Understand form of government (council-manager, strong mayor, commission, etc.)
7. Extract 5 lessons from recent history and identify upcoming items requiring attention

---

## Writing Guidelines

- **Professional but accessible**: 10th-grade reading level
- **Non-partisan**: present facts and multiple perspectives objectively
- **Action-oriented**: focus on what the official can DO, not just know
- **Specific**: "champion the UDO amendments on February 16" not "focus on housing"
- **Honest**: acknowledge complexity, uncertainty, and tradeoffs
- **Direct**: lead with what matters, avoid filler

**Formatting:**
- Bold key figures: budget amounts, vote counts, critical dates, Haystaq scores
- Use bullet points for true lists; write paragraphs for analysis
- Embed inline citations with links in Sections 7–8 — do not bundle at the end
- Citation format: `Point made ([Source Title, Date](URL))`

---

## Output Format

Generate a **professionally formatted PDF** with:
- Title page: official's name, position, location, date
- Consistent heading hierarchy (H1, H2, H3)
- Page numbers
- Professional color scheme (blues/grays for headers)
- 10–12pt body text, appropriate margins
- Source citations in smaller italic font
- Boxed callouts for Good Party polling opportunities

---

## PDF Formatting

### ⚠️ Table Text Color on Dark Backgrounds

`TEXTCOLOR` in `TableStyle` only affects plain Python strings — it does NOT affect `Paragraph` objects. For dark-background header cells, use a white-text `ParagraphStyle`.

**Wrong:**
```python
data = [[Paragraph("<b>Header</b>", BODY_SM)]]  # BODY_SM has black textColor
t.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), NAVY),
    ("TEXTCOLOR",  (0,0), (-1,0), WHITE),  # has no effect on Paragraph objects
]))
```

**Correct:**
```python
TH_WHITE_BOLD = ParagraphStyle("TH_WHITE_BOLD", fontSize=8.5,
                fontName="Helvetica-Bold", textColor=WHITE, leading=12)

data = [[Paragraph("Header", TH_WHITE_BOLD)]]
t.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), NAVY),
    # No TEXTCOLOR needed — ParagraphStyle controls it
]))
```

Define `TH_WHITE` and `TH_WHITE_BOLD` at the top of every PDF generation script. Use them for all header cells on dark backgrounds.

### ⚠️ Row Highlight Colors Must Cover the Full Row

Apply background color to all columns of a row, not just the scored columns.

```python
# Wrong — leaves columns 0-1 white
style_cmds.append(("BACKGROUND", (2, i), (3, i), bg))

# Correct — all columns match
style_cmds.append(("BACKGROUND", (0, i), (-1, i), bg))
```

### ⚠️ Pre-define ParagraphStyles Used in Loops

Never create `ParagraphStyle` objects with the same name inside a loop — ReportLab uses style names as identifiers and duplicate names cause unexpected behavior.

```python
# Wrong
for row in data:
    Paragraph(text, ParagraphStyle("SCORE", textColor=some_color))

# Correct — define once at the top
SCORE_STRONG   = ParagraphStyle("SCORE_STRONG",   textColor=BLUE)
SCORE_MODERATE = ParagraphStyle("SCORE_MODERATE", textColor=AMBER)

for row in data:
    Paragraph(text, SCORE_STRONG)
```

---

## Quality Checklist

Before delivering, verify:

- [ ] Executive Summary is transition-focused with top 3–4 priorities
- [ ] Executive Summary includes specific early win opportunities
- [ ] Lessons Learned provides actionable insights from recent history
- [ ] Quick Wins are specific, achievable, and tied to Haystaq data
- [ ] "What to Watch" identifies upcoming items requiring attention
- [ ] Constituent data queries ran successfully
- [ ] Demographics are accurate and properly formatted
- [ ] Issue scores are correctly tiered
- [ ] Top issues are within local/state authority (no federal issues)
- [ ] All budget numbers are accurate and cited inline
- [ ] Vote counts are correct
- [ ] Official names and titles are accurate
- [ ] Dates are correct
- [ ] Sources are cited inline for all major claims in Sections 7–8
- [ ] No partisan language or bias
- [ ] All 8 sections are complete
- [ ] PDF is properly formatted and readable
- [ ] 3–5 Good Party polling opportunities are included

---

## Example Workflow

**Input:**
```
Name: Dimple Ajmera
Office: City Council Member
Location: Charlotte, NC
```

**Step 1:** Run queries
```bash
cd scripts/python
export AWS_PROFILE=$AWS_PROFILE
uv run query_demographics.py CHARLOTTE nc
uv run query_issue_scores.py CHARLOTTE nc
uv run query_by_zip.py CHARLOTTE nc  # optional, for district analysis
```

**Step 2:** Tier the issues (local/state only)
```
Tier 1 (75+): Affordable housing (78), Public safety (76)
Tier 2 (60–74): Infrastructure (68), Economic development (65), Education (62)
Tier 3 (50–59): Local environment (56), Local taxes (54)
Federal issues excluded: healthcare, abortion, federal immigration, etc.
```

**Step 3:** Research Charlotte City Council — find meeting archives, top 3 budget discussions, top 3 policy discussions, 5 lessons from recent history, upcoming items.

**Step 4:** Generate briefing using V2 structure.

**Step 5:** Quality check against the checklist above.

**Step 6:** Generate PDF.

---

## When You Need Clarification

Ask the user:
- "What time period should I focus on?" (if not specified)
- "Are there specific issues you want me to prioritize?"
- "Should I focus on a specific district or the whole city?" (for district-based elections)
- "Is this person transitioning into the role or already serving?" (to adjust tone)
- "Do you have access to meeting materials I should review?" (if public records are limited)

---

## Troubleshooting

**"ConsumerData_For_Liberal_Democrats_Flag cannot be resolved"**
Schema issue in the Databricks table (a view referencing a column that no longer exists). Contact the data engineering team to fix the DBT model. Workaround: proceed without Haystaq data and note in Section 4 that constituent priorities are based on research rather than voter data.

**"ModuleNotFoundError: No module named 'pandas'"**
Dependencies not installed. Run `cd scripts/python && uv sync`, then use `uv run` instead of `python` directly.

**No Haystaq data found for the city**
Verify the city name spelling matches the Databricks table (`WHERE UPPER(Residence_Addresses_City) = "CITYNAME"`). Try the county or surrounding cities if the city is small.
