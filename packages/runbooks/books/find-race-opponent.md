Given an opponent's name and the race context, find their Ballotpedia page and their campaign website, fetch both, and capture the page text as collected, tagged by source and the exact URL fetched. This is web-only as-collected capture — no interpretation, scoring, or comparison.

This is the source runbook — it captures the human-runnable version of the workflow. Once it's stable, port it into a PMF agent experiment by following `books/convert-runbook-to-experiment.md`. The paired experiment is `experiments/race_opponent_collection/`.

## Prerequisites

**books/.env variables**: none
**scripts/.env variables**: none
**Tools**: web search of your choice (URL discovery), `curl` (the human runbook fetches pages directly; the ported experiment fetches through the broker `/http/fetch` instead — see the note below). Optionally `pandoc` / `html2text` / `lynx -dump` to reduce fetched HTML to readable text.
**Inputs**: one or more opponents. Each row needs: `full_name`, and optionally a `ballotpedia_url` hint and a `website_url` hint. Plus the `race_context`: at minimum the office name, jurisdiction (city / district), state, and election year. The URLs are optional hints — if absent, you discover them by search.
**Output**: for each (opponent, source) you successfully fetch, one record `{ opponent_name, source_type, source_url, content }`, where `source_type` is `ballotpedia` or `opponent_website`, `source_url` is the page you actually fetched, and `content` is the extracted page text/sections. A source you cannot find or fetch is omitted — never invented.

## What you need to know

- **Two sources per opponent, no more.** Ballotpedia (a candidate or race page) and the opponent's own campaign website. That is the whole scope. No news articles, no social profiles, no donor databases — those are later-phase decisions.
- **The source_url must be the page you actually fetched**, after any redirect. If a search result redirects, fetch the redirect target and record that final URL, not the search-result link.
- **As-collected capture only.** Do NOT summarize, score, rank, compare opponents, or extract structured fields. Capture the page text as-is (sections / headings preserved is fine). Normalizing fields is a later-phase decision made after a human reviews this collected content.
- **Omit, never fabricate.** If an opponent has no Ballotpedia page, or no findable campaign website, or a page won't load, leave that source out of the output. A missing source is the correct, expected result for many opponents (especially down-ballot races). An invented URL is a defect.
- **Match the race before trusting a page.** A Ballotpedia page for a same-named person in a different state or a past cycle is the wrong source. Confirm the office / jurisdiction / cycle line up with `race_context` before capturing.

## Steps

### 1. For each opponent, find the Ballotpedia URL

If a `ballotpedia_url` hint was supplied, use it directly (still confirm it is the right person and race below). Otherwise search:

```bash
# Discovery — pick the Ballotpedia result for THIS person + race
#   ballotpedia <full_name> <office> <state> <year>
#   e.g. "ballotpedia Jane Doe Fayetteville City Council 2026"
```

Prefer the candidate page (`ballotpedia.org/<Name>`) or the race page that lists the candidate. Confirm the office, jurisdiction, and cycle match `race_context` before keeping the URL. If no Ballotpedia page for this person in this race is findable, record no Ballotpedia source for them and move on — do not substitute a look-alike.

### 2. For each opponent, find the campaign website

If a `website_url` hint was supplied, use it directly. Otherwise search:

```bash
#   <full_name> for <office> <city> <state> campaign website
#   e.g. "Jane Doe for City Council Fayetteville NC campaign website"
```

Prefer the candidate's own campaign domain (their name / "vote" / "for-office" domain). Skip aggregators, PR-wire pages, and social-media profiles — those are not the candidate's website. If no campaign website is findable, record no website source for them.

### 3. Fetch each found URL and capture the page text + the real source URL

Fetch each URL you kept. In the runbook (human-run) you can fetch directly:

```bash
URL="https://ballotpedia.org/Jane_Doe"
# follow redirects (-L); capture the final URL that served the body
FINAL_URL=$(curl -sSL -o /tmp/page.html -w '%{url_effective}' "$URL")
# reduce to readable text (pick whichever you have installed)
pandoc -f html -t plain /tmp/page.html 2>/dev/null \
  || python3 -c "import sys,html2text; print(html2text.html2text(open('/tmp/page.html').read()))" \
  || lynx -dump /tmp/page.html
echo "fetched: $FINAL_URL"
```

> Note for the ported experiment: the Fargate agent has **no direct egress** and must NOT use `curl` / `requests` / `urllib`. It fetches through the broker instead — `pmf_runtime.http.get(url)` (Chromium-rendered, returns a dict with `body` and `source_url`) — and records the returned `source_url` as the page actually fetched. The runbook uses `curl` only because a human runs it locally; the capture contract (the page text as collected + the real fetched URL) is identical.

Record `source_url` = `$FINAL_URL` (the page that actually served the body, after redirects). Record `content` = the extracted page text/sections. If the fetch fails (non-200, empty body, blocked), omit that source.

### 4. Assemble the output

Emit one record per (opponent, source) you successfully fetched:

```json
[
  {
    "opponent_name": "Jane Doe",
    "source_type": "ballotpedia",
    "source_url": "https://ballotpedia.org/Jane_Doe",
    "content": { "text": "Jane Doe (Fayetteville City Council) ... <full extracted page text> ..." }
  },
  {
    "opponent_name": "Jane Doe",
    "source_type": "opponent_website",
    "source_url": "https://janedoeforcouncil.com/",
    "content": { "text": "<full extracted page text> ..." }
  }
]
```

An opponent with neither a findable Ballotpedia page nor a findable website contributes zero records. An opponent with only one of the two contributes one record.

## Data-quality bar (must follow)

- Every record carries a real `source_url` that actually served the body. No fabricated, guessed, or unfetched URLs.
- `source_type` is exactly `ballotpedia` or `opponent_website`.
- `content` is unstructured page text — not a summary, not scored, not compared against another opponent.
- A source that can't be found or fetched is omitted. Omission is correct; invention is a defect.
- Plain, direct U.S. English in any prose you add (there should be almost none — this is as-collected capture). No em dashes.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| A Ballotpedia page is for a same-named person elsewhere | Name collision across states / cycles | Confirm office + jurisdiction + cycle against `race_context` before capturing; otherwise omit the source |
| The "campaign website" is an aggregator or PR-wire page | Search returned a non-candidate domain | Only capture the candidate's own campaign domain; skip aggregators / social profiles |
| `source_url` doesn't match the page you read | Recorded the search-result link, not the redirect target | Record the final URL that served the body (curl `%{url_effective}`; broker `source_url`) |
| Tempted to summarize or rank the opponents | Over-reaching into later-phase analysis | As-collected capture only — no interpretation, scoring, or comparison in this workflow |
| (Ported experiment) a fetch hangs ~30s then fails | A direct network call (`curl`/`requests`/`urllib`) inside the no-egress Fargate container | In the experiment, fetch only via `pmf_runtime.http.get`; never make a direct network call |

## Promote to a self-service experiment

This runbook is the human-runnable precursor. To make it a self-service CAP background agent (`race_opponent_collection`), follow `books/convert-runbook-to-experiment.md`. The pairing:

- This runbook: `find-race-opponent.md`
- The PMF experiment: `experiments/race_opponent_collection/`

The translation encodes everything here into `manifest.json` (the `{ opponents, race_context }` input contract + the required per-item `{ opponent_name, source_type, source_url, content }` output contract; no Databricks scope — this is web-only) and `instruction.md` (the same steps written for the agent, with the no-egress broker rules called out as CRITICAL RULES). See `experiments/CLAUDE.md` for the pattern.
