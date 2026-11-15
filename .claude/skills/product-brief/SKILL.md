---
name: product-brief
description: >-
  Turn voice-of-customer research into a product brief for a feature or problem
  space, ending in a paste-ready prototype prompt. Use when a PM or designer wants
  to explore a feature, opportunity, or "how do users do X" question and needs a
  grounded write-up with the research, verbatim customer quotes, and a Claude
  Design prompt to spin up a prototype. This is the process used for the
  Legislation, Issues, Budget, and Priorities briefs. Triggers on "write a product
  brief", "research brief for <feature>", "explore <feature> for Win/Serve",
  "turn this research into a prototype prompt", "feature brief".
---

# Product brief

Produce a GoodParty feature brief: a write-up that moves from real customer evidence to a defensible product direction to a paste-ready prototype prompt. The output is one markdown file saved into product-os's `docs/research-briefs/` folder.

This skill builds on top of `voice-of-customer`. That skill is how you gather and cite evidence; this skill is how you turn that evidence into a brief and a prototype prompt.

## Step 0 — Find product-os

Briefs quote customers, so they live in the private `thegoodparty/product-os` repo, never in Omni. Omni is public, and a push to its `main` starts a release.

1. Resolve the product-os checkout: `$PRODUCT_OS_DIR` if it is set, otherwise `../product-os` next to the Omni checkout. In a cloud session, add `thegoodparty/product-os` as a second repository.
2. If neither is a product-os checkout, stop and tell the user to run `git clone https://github.com/thegoodparty/product-os ../product-os` from the Omni root, or set `PRODUCT_OS_DIR`.
3. Run `git -C <product-os> pull --ff-only`.

Every `docs/research-briefs/` and `customers/` path below is relative to that checkout. Never write the brief, or any quote from it, into Omni.

## The examples to match

The gold-standard examples live in product-os `docs/research-briefs/`:
- **`docs/research-briefs/serve-solving-issues-research.md`**: the primary model. This is the Legislation/Issues research: a process-model brief (a six-stage model + a solution taxonomy with a "workflow fit" column) ending in a `Prototype prompt` whose worked example is an ordinance workflow. Lead with this one for structure, voice, and citation discipline.
- `docs/research-briefs/eo-budget-interaction-brief.md`: a secondary example for the thesis-led shape, with a single-page concept and a `Lovable prompt v1`.

Read the issues/legislation brief before writing, and mirror its structure, voice, and citation discipline.

## Step 1 — Scope the brief with the user

Pin down four things before researching. Ask only for what is missing; infer the rest and confirm.

1. **Topic / question.** The feature or problem space (e.g. "how EOs interact with the budget", "solving issues", "priorities"). Frame it as a job to be done, not a feature name, when you can.
2. **Product and audience.** Win = candidates. Serve = elected officials / EOs. This routes all the research and sets the persona: Carla for Serve, Dana Ortiz for Win (both in [`docs/design-memory/fixtures.md`](../../../docs/design-memory/fixtures.md)). Never blend Win and Serve unless the user explicitly asks to compare.
3. **Scope boundaries.** What's in and out. The budget brief opens with a scope note ruling out the EO's personal/office budget. A sentence of scope-setting prevents a wandering brief.
4. **Prototype target.** Default to Claude Design, in Claude Desktop or claude.ai. The prompt should describe an agent, never a "chatbot."

## Step 2 — Gather the evidence (via voice-of-customer)

Invoke the `voice-of-customer` skill to pull grounded, cited material. Do not synthesize from raw calls yourself. Route through it and follow its rules:

- Pick the audience track (`win/` vs `serve/`) and the research track (user-research for behavior/friction, marketing-research for voice/testimonials).
- For patterns, start from the human-reviewed `themes/` syntheses. Cite them by date so the reader knows the patterns are reviewed, not invented.
- **Every quote is verbatim and cited** with participant, file (as a clickable link), and timestamp, e.g. *<Participant name>, [YYYY-MM-DD-participant-name.md](customers/user-research/serve/YYYY-MM-DD-participant-name.md) [mm:ss]*. Quote exactly; never paraphrase into quotation marks.
- Note confirmation strength when a synthesis gives it ("confirmed across 3 of 4 Serve calls").
- **Consent gates external use.** Marketing-track quotes are only cleared for publication if tagged `[External OK]`. All user-research content is internal only. State the handling at the foot of the brief.

Aim for evidence that is consistent across multiple participants, and be honest in the method section about what the archive does and does not cover.

## Step 3 — Find the spine

Before drafting, decide the organizing structure. The two example shapes:

- **Process-model** (the issues/legislation brief, the default): a headline, then a staged model of how users actually do the job today, then a decision framework and a solution taxonomy with a "workflow fit" column. Use when the answer is "here is how the job works, and where a workflow fits." Reach for this first.
- **Thesis-led** (budget brief): a sharp thesis + strategic wedge, then numbered findings, then composable interaction layers, then a single-page concept. Use when the answer is "here is what we should build."

Pick whichever the evidence supports. Look for a **strategic wedge**: how this connects to assets GoodParty already has (polling data, meeting briefings, CRM). The budget brief's wedge is overlaying constituent-priority data onto budget allocations.

## Step 4 — Write the brief

Use this skeleton, adapting section names to the spine. Match the existing briefs' plain, direct voice.

1. **Title**: `Serve product brief: <topic>` or `Serve research: <question>` (swap Serve/Win). One-line framing under it, noting it ends with a prototype prompt.
2. **Owner / date / product**: `Owner: <name>. Date: <today>. Product: Serve|Win.`
3. **Scope and method**: what archive, roughly how many calls, the citation discipline, and an honest note on coverage gaps.
4. **Thesis / headline**: the core insight in a few sentences, plus the strategic wedge. A short numbered list of why the problem is hard is effective.
5. **What the evidence says** (or a staged process model): the heart of the brief. Numbered findings or stages, each grounded in verbatim cited quotes and cross-referenced to the syntheses.
6. **Framework / taxonomy** (optional): a decision framework or a solution-type table with a "fit for a guided workflow" judgment, when the topic warrants it.
7. **What this means for <the feature>**: numbered product implications drawn straight from the evidence.
8. **The single <Feature> page** (optional): a concrete page concept with named regions, when you're proposing one surface.
9. **Prototype prompt**: see Step 5.
10. **Open questions to resolve before building**: the real unknowns (ingestion, normalization, accuracy bar, who acts).
11. **Suggested next step**: name 3–4 specific users to validate with, ideally ones who already do this by hand.
12. **Files used**: folder guide, syntheses, and a note on consent/internal handling.

## Step 5 — Write the prototype prompt

A self-contained block the user can paste into Claude Design. Set it off clearly (its own heading; the issues brief fences it with `---`). It must:

- **Open with this exact line, before anything else:**

  ```
  Use the goodparty-design skill.
  ```

  That skill carries GoodParty's accumulated design rules and standard fixtures, and
  fetches the current versions from
  [`docs/design-memory/`](https://github.com/thegoodparty/omni/tree/main/docs/design-memory)
  in omni at the start of every session. Naming it explicitly makes it fire
  deterministically rather than relying on the model matching the skill's
  description. Do not restate the rules it already carries (voice, sentence case,
  no em dashes, inline citations, Carla, Dana Ortiz and Maplewood) in the prompt itself; keep
  the prompt about *this feature*, and let the skill supply the *how*.

- Describe **an agent**, not a chatbot. State the audience and the one core principle up front (e.g. "the official already knows the priority; the agent does the research and translation between priority and action").
- Lay out the flow concretely, as a stepper or named page regions, so a user can click through a full arc.
- **Mirror the existing product family** where relevant. Tell the prototype to reuse the shell and capabilities of our existing Ordinances and Issues prototypes (source citation drawer, suggested questions, elevate-to-staff, push-to-community, corrections UX) so it feels like one product, not a separate tool.
- Include **mock or worked data** for a fictional case so the prototype is tangible (the budget brief uses the City of Maplewood; the issues brief uses a township speeding ordinance). Hardcode at least one example end to end. Use the fixture personas, never a real participant from the archive.
- Leave GoodParty norms to the skill. Voice, sentence case, no em dashes, no emoji, inline citations, local over national comparisons, printable output, and the Carla and Dana Ortiz personas all live in `docs/design-memory/learned.md` and `fixtures.md`, which the skill fetches fresh. Repeating them here means two copies that drift, and the stale one wins whenever someone edits the brief instead of the memory. Only state a norm in the prompt when this feature genuinely departs from the standard, and say why.

## Step 6 — Save it

Save to product-os `docs/research-briefs/` with a descriptive kebab-case filename matching the existing convention: no date prefix, the date lives inside the file. Examples: `serve-priorities-brief.md`, `win-<topic>-brief.md`. Confirm the filename with the user, then tell them where it landed.

Then ship it to product-os `main`. A brief left uncommitted in a working tree, or stranded on a feature branch, is not really filed, and the `product-one-pager` skill expects the brief to be on `main` so the one-pager can link to it. Run every git command against product-os with `git -C <product-os>`, never against Omni:

- Make sure product-os is on `main` and current (`git -C <product-os> pull --ff-only`).
- Stage only this brief at `docs/research-briefs/<file>.md` using its explicit path.
- Commit with a message like `product-brief: add <topic> brief` ending with the standard `Co-Authored-By` trailer.
- `git -C <product-os> push origin main`. If the push is not clean, stop and tell the user rather than forcing it.

## The rules that matter

1. **Ground everything in cited, verbatim quotes.** No invented patterns, no paraphrase-in-quotes. If the evidence is thin, say so rather than inflating it.
2. **Route synthesis through the reviewed `themes/` files**, not your own cross-call recombination. That's the `voice-of-customer` rule and it holds here.
3. **Respect consent and internal-handling rules.** External-facing use needs `[External OK]`; user-research is internal only. State the handling in the brief.
4. **Never blend Win and Serve** unless asked to compare, and label clearly if you do.
5. **Briefs live in product-os, never in Omni.** Omni is public. Nothing from the brief goes into an Omni file, PR, or commit.
6. **Agents, not chatbots.** Honor GoodParty voice throughout: plain US English, no em dashes, no emoji, sentence case.
