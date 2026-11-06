---
name: product-one-pager
description: >-
  Create a Feature One-Pager card in ClickUp from a product brief. Takes the
  learnings from the product-brief skill (problem, evidence, quotes, proposals,
  prototype) and fills the "Feature One Pager" task template on the Product team's
  Problems Roadmap board, then assigns it to whoever created it. Use when a PM
  wants to turn a brief into a tracked one-pager, "create a one-pager", "make a
  ClickUp feature card", "file this brief in ClickUp", "product one pager".
---

# Product one-pager

Turn a product brief into a Feature One-Pager card in ClickUp. This is the companion to `product-brief`: that skill produces the research and prototype prompt; this skill files it as a structured one-pager on the Product roadmap board so it is tracked alongside everything else.

There are two outputs: a new ClickUp task created from the **Feature One Pager** template (filled from the brief, assigned to the person running the skill), and a local markdown copy of the same filled body saved into product-os's `docs/product-one-pager/` folder so the org has a record alongside the research briefs.

## Where the files live

The brief, the learnings file, and the local copy all live in the private `thegoodparty/product-os` repo, never in Omni. They quote customers, Omni is public, and a push to Omni's `main` starts a release.

Resolve the product-os checkout before anything else: `$PRODUCT_OS_DIR` if it is set, otherwise `../product-os` next to the Omni checkout. In a cloud session, add `thegoodparty/product-os` as a second repository. If neither is a product-os checkout, stop and tell the user to run `git clone https://github.com/thegoodparty/product-os ../product-os` from the Omni root, or set `PRODUCT_OS_DIR`. Then run `git -C <product-os> pull --ff-only`, so you read the latest approved learnings.

Every `docs/`, `customers/`, `processes/` and `onepager-feedback-loop/` path below is relative to that checkout. Run every git command with `git -C <product-os>`, never against Omni.

## Fixed coordinates

These are stable. Confirm them at runtime rather than trusting this file blindly, but they are the starting point:

- **Workspace (team):** `90132012119` (goodparty.clickup.com)
- **Board / list:** `901327608453`, "Problems Roadmap (Board)" in the Product space. This is the list new cards go in.
- **Template task to mirror:** `86aj8eucg`, the "Feature One-Pager" template instance. Read it at runtime to get the current template body and field set (see Step 2).

## Step 0 — Read the learnings file

Read `onepager-feedback-loop/learnings.md` in product-os before writing anything. It holds observed
preferences for how a one-pager should read, learned from the edits Bryan actually made to previous
cards after this skill filed them.

Treat those notes as binding as the steps below. Each one exists because this skill produced
something that had to be rewritten by hand; applying it is what stops the same correction being
necessary again. Where a note and a general instruction here pull in different directions, follow
the note. It is the more specific and more recent signal.

Do not edit that file as part of running this skill. It is maintained by product-os's
`onepager-feedback-loop/`, and every note in it was approved by Bryan before it landed. The same
loop proposes changes to this `SKILL.md` as Omni PRs.

## Step 1 — Get the brief

The one-pager is filled from a product brief. Find or create it:

1. If the user names a brief or one exists in `docs/research-briefs/` for this topic, read it. These are the gold source: they already carry the problem framing, cited quotes, proposals, and prototype prompt.
2. If no brief exists yet, run the `product-brief` skill first, then come back. Do not hand-write a one-pager from scratch when the brief flow exists. The whole point is to reuse that research.

Confirm with the user which brief you are turning into a card before writing anything to ClickUp.

## Step 2 — Read the live template

Templates are not retrievable through the ClickUp API, so mirror the template task instead of guessing:

- `clickup_get_task` on `86aj8eucg` with `include: ["custom_fields", "description"]` to get the current markdown body and the field definitions.
- `clickup_get_custom_fields` on `list_id: 901327608453` to confirm field IDs and dropdown option IDs.

Always map fields **by name to ID at runtime**. IDs can change. The IDs below are reference only.

## Step 3 — Anchor to a top-level metric

Before filling Hypothesis or How we measure success, pin the feature to one of our three top-level metrics. Work backwards from it rather than inventing a bespoke success framing per feature:

- **Acquisition**: a new candidate or EO signs up and starts using the product.
- **Activation**: the user comes back a second time, typically pulled back by an alert or trigger: a meeting briefing, a new community issue, weekly TODOs for their governance plan, etc.
- **Retention**: sustained, repeated usage over time. This is usually the compounding result of an activation loop working, not a separate mechanism to design for directly.

Pick the single top-level metric the feature is most directly rooted to. Most features should land on Activation or Retention as a downstream consequence of a loop, not Acquisition, unless the feature is explicitly about getting new users in the door. For example: meeting briefings are rooted to **Retention**. The user comes back for every meeting they attend, so the loop is the mechanism, and retention is the outcome it produces. Name this top-level metric explicitly; do not leave it implicit.

## Step 4 — Fill the template body

Reproduce the template's markdown structure exactly, filling each section from the brief. The template is nine sections under a title. **Write the same problem-statement title the card gets (Step 6), with no `Feature brief:` prefix**, so the body title and the ClickUp task name read identically.

1. **At a glance** (a table): only four rows: Feature name (external), one-line description, Lead dev, Designer. Leave dev/designer blank if unknown. Do NOT add Product, Plan, Owner, or Team rows even though the raw template task shows them. Those live in dedicated custom fields (Step 5), and the body table must stay lean to match how the card actually renders in ClickUp. Set Product, Plan, and Owner/Driver via their custom fields, not in this table.
2. **Overview**: a 2–3 sentence elevator pitch (from the brief's thesis/headline), then **Problem statement** (what are we solving / for whom / why is it a problem / how do we know, the last one grounded in the brief's evidence) and **Hypothesis** ("We believe building X will help <who> <outcome>. We'll know it worked when <signal>."). State which top-level metric (Acquisition / Activation / Retention, from Step 3) the outcome in the hypothesis rolls up to.
3. **Solution**: Proposal A/B/C from the brief's interaction layers or solution options. Say which one we are doing: mark the proposal being pursued as recommended, and strike through any proposal already ruled out rather than deleting it. If every proposal is in scope, say so in a closing line. Ask the user which path is chosen when the brief does not say.
4. **Why it's needed: voice of customer**: **Quotes** (verbatim, each with participant, source file link, and timestamp) and **Themes** (reference the synthesis file and date). Pull these straight from the brief; do not invent. The one-pager is an internal artifact, so quotes don't need external-use consent. Include them with attribution regardless of any consent tag in the brief. (If you later lift a quote into external-facing material, check its clearance then.) **On the ClickUp card, every link to a product-os file (quote source, synthesis, the source brief) must be an absolute GitHub blob URL, not a repo-relative path.** ClickUp does not resolve relative links, so `[file.md](customers/...)` renders as dead text there. See Step 6 for how to build the URLs. (The local copy in Step 7 keeps repo-relative links, which resolve on GitHub.)
5. **See it**: prototype link, Figma/lo-fi, recording, screenshots. Each of these is a link slot: put the real URL in it, or leave it empty. Do not write prose in a slot, and in particular do not write "not built yet" or point at the prototype prompt in the brief. The source brief keeps its own line, which is also a link.
6. **Who it's for**: primary user/segment and when in their journey it matters (Carla for Serve, Dana Ortiz for Win).
7. **Scope**: In scope by Phase 1/2/3 (map the brief's build sequence), plus Out of scope. Write each item as the capability being built and stop there. Do not commit a scope item to a platform, a device, or a specific UI affordance unless the user has decided it, even when the brief mentions one. Only write a phase that is actually committed. Do not pad the scope to three phases because the template has three. One phase is a complete answer, and later work that is real but not agreed belongs in Out of scope with a reason. Before writing a new status, chip, filter, feed entry, screen or page into scope, check whether something already in the product can carry it, and name what it lands in. Invent a new surface only when nothing existing fits, and say why. Check the same way before claiming a scope item needs building at all.
8. **What it changes**: replaces/retires, pairs/overlaps, deprecations. When the feature moves or retires a route, or retires or renames a tracked event, add a "Links and tracking other teams depend on" subsection: a table of old route to new home, a rule that every old URL lands on the same thing (redirects keep IDs and UTM parameters), and a rule that marketing signs off on the change list before it ships. Add a Phase 1 scope line that makes this a gate on every phase, and end How we measure success with a line that none of the new events ship until marketing has reviewed the change list.
9. **How we measure success**: state the top-level metric from Step 3 first, then the primary metric and leading/lagging indicators, framed as how they roll up to it. Follow with new Amplitude events, formatted as a markdown table with columns `Name | Properties | When it fires` (one row per event; leave Properties as `—` if none). Follow product-os `processes/analytics-standards.md` naming when proposing events. Before proposing a new event, check whether an existing event already fires at that moment and can carry a new property instead. Prefer the existing event with a distinguishing property, and mint a new name only when nothing existing fires there. When no new events are needed, say so and list the existing events with the properties being added. Use one property name for one concept across the table. Name the full object, not the bare action: qualify the noun with the feature when the product area covers more than one feature (`Voter Outreach - Phone Banking Call List Created`, not `Voter Outreach - Call List Created`), and with the record it acts on when the action alone is ambiguous (`Voter Data - Contact Note Added`, not `Voter Data - Note Added`).
10. **What not to claim**: compliance/legal cautions and framing to avoid. Carry over the brief's consent constraints (anything `[Internal only]` is not cleared for external use).

Leave a field blank rather than fabricating. Honor GoodParty voice: plain US English, no em dashes, no emoji, sentence case.

## Step 5 — Set the required custom fields

The template has four **required** fields. The create will fail required-field validation without them. Resolve current IDs at runtime; reference values:

- **Product** (`d9947206-...`, dropdown): Win / Serve / Data / Other. From the brief's product. The dropdown has no "Run" option (despite the raw template's at-a-glance label); map a Run feature to Other, or to the closest real option.
- **Plan** (`0133a96a-...`, dropdown): Free / Pro / N/A. Ask if the brief doesn't say. There is no "Both" option (despite the raw template's label); for a feature that spans tiers, confirm with the user and otherwise use N/A.
- **Product Name** (`8375f71c-...`, short text): the feature name.
- **Launch Tier** (`909aa79c-...`, dropdown): Small / Medium / Large / N/A. Default N/A for an early one-pager unless the user has a view.

Also set where you can: **Type** = Feature, **1- D - Driver** = the creator (people field), **Problem Statement** and **Hypothesis** (text fields, mirror the body), and **Impact** if the brief supports an estimate. Pass `check_required_custom_fields: true` so a missing required field surfaces before the card is half-created.

## Step 6 — Create and assign

- Create the task in `list_id: 901327608453` with `clickup_create_task`: `name` = **the problem, stated from the user's point of view**, `markdown_description` = the filled body, the custom fields from Step 5.
- **Name the card after the problem, not the feature.** It is the Problems Roadmap, so a card earns its place by naming what is wrong for a candidate or an EO, not by labelling the thing we plan to build. Two shapes both work, so pick whichever reads better for the card:
  - the problem on its own, e.g. `Candidates need to send ads to voters`, `Candidates need to be able to self-serve robocalls`;
  - the feature, a hyphen, then the problem, e.g. `Constituent ratings - Constituents can rate and review their elected officials`, `Public Profile - EOs want a place to transparently show their constituents what they're focused on solving`.
  Write it in plain language, as the user would describe their own situation. `Branding Studio` is a label; `Candidates need to design material or branding relative to their campaign` is a problem. If the brief's problem statement already says it well, reuse that wording rather than inventing a new phrasing.
- Never prefix the card name with `Feature brief:`. It lands on every card, pushes the real name past the truncation point in board view, and makes cards harder to scan and search. The body title (Step 4) carries the same problem statement, so the card and the body read the same.
- **Use absolute GitHub URLs for every product-os file link in the card body.** ClickUp will not resolve repo-relative paths, so the local body's `[file.md](path/to/file.md)` links must be rewritten to `https://github.com/<org>/<repo>/blob/<default-branch>/<path>` for the card. Build the base from **product-os**, not Omni: `git -C <product-os> remote get-url origin` (strip any credentials and the `.git` suffix), and the branch from `git -C <product-os> branch --show-current` (normally `main`). For example `customers/user-research/win/YYYY-MM-DD-participant-name.md` becomes `https://github.com/thegoodparty/product-os/blob/main/customers/user-research/win/YYYY-MM-DD-participant-name.md`. This is the one place the card body diverges from the local copy.
- **Assign to whoever created it.** Resolve `"me"` with `clickup_resolve_assignees` and pass that user ID in `assignees`. Set the same user on the **1- D - Driver** field. ("Whoever created it" = the authenticated user running the skill, not hard-coded to anyone.)
- **Never set or change the card's status.** Let it take the list default on create, and never touch the `status` field on an existing card. See rule 1 below.

## Step 7 — Save a local copy

Write the same filled one-pager body (the markdown from Step 4) to product-os `docs/product-one-pager/`, the sibling of `docs/research-briefs/`, so there's a repo record next to the source brief. This is the body only, with no need to reproduce the custom-field values.

- Filename: kebab-case from the feature name, matching the brief's convention: no date prefix, the date lives inside. Example: a brief at `docs/research-briefs/serve-priorities-brief.md` produces `docs/product-one-pager/serve-priorities-one-pager.md`.
- Add a single reference line at the top, under the title, linking back to the ClickUp card (the URL from Step 6) and the source brief, so the three artifacts stay connected.
- If a file with that name already exists, confirm with the user before overwriting.

## Step 8 — Ship it to product-os main

The local copy is worthless until it is on product-os's default branch. Commit it and push to product-os `main` directly. This artifact ships to `main`, not to a feature branch and not left uncommitted in a working tree. It never goes to Omni.

- Make sure product-os is on `main` and current: `git -C <product-os> pull --ff-only`. If product-os is on another branch, switch it to `main` (carry the new file across) unless the user has told you to work elsewhere.
- Stage only what this skill produced: the new one-pager at `docs/product-one-pager/<file>.md`, and its source brief under `docs/research-briefs/` if that brief is not yet committed. Use explicit paths so you never sweep in unrelated working-tree changes.
- Commit with a clear message, e.g. `product-one-pager: add <feature> one-pager`, ending with the standard `Co-Authored-By` trailer.
- `git -C <product-os> push origin main`.
- If the push is rejected because `main` moved, pull with rebase and push again. If anything about the push is ambiguous or fails, stop and tell the user rather than forcing it.

## Step 9 — Confirm

Return the ClickUp task URL, the local file path, and the pushed commit, plus a short summary: what got filled and what you left blank for the user to complete (typically dev, designer, exact metrics, launch tier).

## The rules that matter

1. **Never change a card's status.** When creating or filling in a one-pager, do not set or update the `status` field. Status changes trigger downstream automations and events, and only a human should move a card. Let a new card take the list default; on an existing card, leave status exactly as you found it.
2. **Fill from the brief, don't invent.** Every quote and theme must trace to the brief (and through it to the VoC archive). Blank beats fabricated.
3. **The card is internal.** Quotes can go on the card with attribution without external-use consent. Just don't reuse them in external-facing material without checking clearance separately.
4. **Required fields or the create fails.** Product, Plan, Product Name, Launch Tier must be set.
5. **Two outputs, kept in sync.** The ClickUp card is the tracked artifact; the product-os `docs/product-one-pager/` markdown file is the repo record of the same body. Save both, and link the local copy back to the card and the source brief. The one intended divergence: product-os file links are absolute GitHub blob URLs on the card (so they are clickable in ClickUp) and repo-relative in the local copy (so they resolve on GitHub). See Step 6.
6. **Ship the local copy to product-os `main`.** Saving the file to disk is not the finish line. The skill is not done until the one-pager is committed and pushed to product-os `main`. Never leave it uncommitted or stranded on a feature branch. Stage explicit paths so unrelated changes are not swept in, and stop and ask if the push is not clean.
7. **Nothing goes to Omni.** Omni is public. The one-pager, the brief and their quotes never land in an Omni file, PR, or commit.
8. **Assign to the creator**, both as assignee and as Driver.
9. **Map fields by name at runtime.** Don't trust hard-coded IDs if the live template disagrees.
10. **GoodParty voice throughout:** plain English, no em dashes, no emoji, sentence case.
11. **Apply `learnings.md`.** The notes in product-os `onepager-feedback-loop/learnings.md` come from real
    edits Bryan made to earlier cards and carry the same weight as these rules. Read them in Step 0 and
    follow them; where one is more specific than a general instruction here, the note wins.
12. **Titles are problems, not feature labels.** The card name and the body title both state the
    problem in the user's own terms (Step 6). The feature name still lives in the At a glance
    table's "Feature name (external)" row, which is the right place for it.
13. **Root every hypothesis and success metric to a top-level metric.** Every feature's Hypothesis and How we measure success sections must name which of Acquisition, Activation, or Retention (see Step 3) the outcome serves, and work backwards from it. Don't leave the top-level metric implicit or invent a bespoke outcome that doesn't roll up to one of the three.
