Plain-language guide to generating a governing roadmap with Claude Code, written for the account manager who requests it. You do not need to be technical or know the steps. Claude Code reads the full procedure (`books/generate-governing-roadmap.md`) and does the work; you provide a few inputs and review the result.

## What you get

For one elected official, three files:
- **D-Long** — the full ~20-25 page strategic governing roadmap, written to the EO.
- **D-Short** — a 2-3 page tactical action plan, the version they read on their phone.
- **AM summary** — internal, just for you. It tells you what to confirm before sending, what assumptions were made, and how to introduce the documents.

The two EO-facing documents are delivered as PDFs, saved in the output folder and uploaded to the shared Drive folder if you have connected Google.

## Your first run

There is nothing to configure and nothing to look up first. You give the EO's name and office; Claude Code does the rest. The first time only, it will install anything it needs to build the PDFs (you may see it install `pandoc`).

Two optional logins make it nicer, not required: connect HubSpot if you want it to pull CRM details automatically, and connect Google if you want the PDFs uploaded to the shared Drive folder for you. Skip both and the roadmap still generates, with the PDFs saved in the output folder for you to share. The one thing to have is the repo open in Claude Code; if it is not, ask once for help cloning it.

## How to run it

1. Open the repo in Claude Code.
2. Type a plain request, for example:

   > Generate a governing roadmap for Jane Doe, City Council At-Large, Riverton. Her intake form is in the sample-intakes folder.

3. Claude Code finds this workflow on its own (via `books/INDEX.md`), then researches the jurisdiction, drafts both documents, verifies every fact, runs an internal quality check, and builds the PDFs (uploading them if Google is connected). Let it work; it will tell you what it is doing.

**Have ready:** the EO's full name, their office, and their city or jurisdiction. An intake form helps if you have one, but is not required.

## Before you send: read the AM summary

The single most important thing you do is read `am-summary.md` and clear its "before you send" checklist. It lists specific facts to confirm (a committee assignment, a filing deadline, a vote count) with where to find each. Do not forward the PDFs to the EO until those items are checked. The summary also gives you talking points for introducing the D-Short, the D-Long, and the modeled data.

## If something looks off

- **Accuracy flags remain.** Ask Claude Code to resolve every open flag before you send. Tell it: "resolve the remaining verification flags and re-verify."
- **The internal quality check came back REVIEW.** That usually means thin public data for a small jurisdiction. Ask Claude Code to deepen the research; if no sources exist, the gaps should be labeled honestly, not papered over. Do not chase the score for its own sake.
- **No PDF was produced.** Ask Claude Code to run the setup check (Step 0); it will install what the PDF step needs.
- **EO not found in HubSpot.** Confirm you are logged into the right HubSpot account and that the record exists, then re-run.

## See it first

For a full anonymized example of what a finished package looks like, see `books/example-roadmap-package.md`.
