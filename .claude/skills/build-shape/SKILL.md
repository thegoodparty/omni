---
name: build-shape
description: Produce 2-3 options for how to build a feature, as one short visual page drawn on our real system and published to a private Vercel artifact link, so reviewers can pick a technical direction in two minutes. Use when someone asks for a build shape, build options, technical options, a technical direction, or how to build a feature or ticket, before anyone writes a detailed design, and instead of a TDD for early review. Also run by ux-review-options to attach one build to each UX option.
---

# Build shape

A build shape shows two or three ways to build a feature, each drawn on the system
we already run. A reviewer should learn what they need in two minutes: what each
option builds on, what it adds, how it handles the hard part, and where they would
object.

## Audience

The reader is technical and knows our codebase in general, but may not know the
system this feature touches or adds. They have two minutes. The page has three jobs,
in this order:

1. **Ground them in today.** Before any option, say in two or three plain sentences
   how this part of the product works now: who or what does the job, through which
   systems, and what is missing or painful. The maps then show today's parts in gray,
   so the reader sees the same system before and after.
2. **Show the overall change.** Each option opens with what changes compared with
   today, in one or two sentences, before any detail.
3. **Highlight what matters.** In each rail bullet, bold the one detail that matters
   most for the decision (a new credential, a cost, a limit, a side effect). At most
   one bold phrase per bullet, and not every bullet needs one.

Never assume the reader knows this subsystem's own names. The first time a name
from this area appears in text, say what it is.

## Why this exists

Long design docs spend most of their words on detail stacked on a foundation. When
the foundation is wrong (a managed service we could have used, or the job is already
done another way today), a reviewer sees it in the broad strokes and the detail is
thrown away. So this page shows only the broad strokes, mostly as pictures. Detail
comes later, from the agent that builds the picked option.

Read `reference/good-and-bad.md` and `reference/technical-writing.md` before you start.

## Inputs and where the work lives

The input is a ClickUp ticket URL or a pasted spec, plus any docs it links. Read the
ticket, its comments and every linked doc with the ClickUp MCP (`docs/mcp.md`).

Work in a scratch folder outside any repo, `<work>/`. The page goes in
`<work>/page/index.html` and the notes in `<work>/build-shape-notes.md`. This repo
is public: ticket text, notes and the page never get committed here.

## Rules

- **One option if only one is credible.** If every other approach you find is
  filler, draw one option and say in one line under the job why there is no
  second. Do not invent a contrast.
- **Two or three options, no recommendation.** Never rank, score or pick a winner.
  Each option is the best version of itself.
- **Every option is credible.** Each is one a senior engineer here would put forward
  and defend. Never pad the set with a weak option to reach three or to show a
  contrast. Two strong options beat three with a filler.
- **Options differ in foundation.** Each one builds on something different: a
  different existing part, a different vendor or managed service, a different place
  the work happens. Two options that differ only by library, table layout or naming
  are one option.
- **Reuse over new.** Prefer what exists. Every new part has to earn its place.
- **Everything named is real.** Every existing part on the page maps to a real path
  in this repo, a real resource in our infra code, or a vendor we already use. Never
  draw a part that does not exist as if it did.
- **Pictures over prose.** The map carries the option. The rail is a few short,
  plain bullets: at most three per heading, each one complete sentence of about 20
  words or fewer. No Prisma models, field lists, endpoint tables or code.
- **Plain language.** Follow `reference/technical-writing.md`. Short is not the goal on its
  own: a cryptic fragment costs the reader more than a clear sentence.

## Process

1. **Read the input.** The ticket and its linked docs (see "Inputs"). Write the job
   in one sentence: who needs what, and why.
2. **Find the hard part.** Name the one or two problems that decide whether this
   feature works in production, from what you know of this kind of system (for
   example: for payments, double charges; for webhooks, retries and ordering; for
   search, relevance and freshness). These become the "hard part" every option
   must answer.
3. **Learn the system.** Read `AGENTS.md`, `docs/architecture.md`, and the
   `AGENTS.md` of every package the feature touches. Then read the code the feature
   touches: routes, services, queues, jobs, tables, admin tools, infra code.
4. **Find the building blocks.** This is research for you, not content for the page.
   - **How it is done today.** By code, by a person in an admin tool, by staff by
     hand. Note who does it and with what access.
   - **Our parts.** Modules, queues, tables, jobs, buckets, triggers and admin tools
     that do something close.
   - **Platform services.** The managed services of every platform we already run
     on (our cloud account, hosting, auth, data warehouse, CRM), including ones not
     wired into code yet. A service on a platform we already pay for is close to
     free to adopt, so it is a first-class candidate foundation.
   - **Vendor features.** For each vendor we use that is relevant, the features
     that fit, especially ones that solve the hard part for us.
   - **Side effects.** What existing behavior the new work would trigger or touch:
     jobs, notifications, agent runs, stats and counts, opt-outs, billing. A new
     record that looks like a real one gets treated like a real one.
   - **Known limits.** The latency, cost, rate limits and failure modes of each part
     an option would lean on, from the code and docs. A part that is slow, costly or
     rate limited cannot sit in a path that needs to be fast or cheap.
5. **Question the premise.** Before picking options, ask what a skeptical staff
   engineer would ask first:
   - What is the smallest thing that does the job? Which requirement costs the most,
     and what happens if we drop or defer it?
   - If people or another system already do this job today, why can't the new
     thing work the same way, with the same access and the same channels?
   If the answer is a credible smaller build, it is one of the options.
6. **Pick the options.** Two or three credible ones on different foundations. If a
   platform service or vendor feature solves the hard part, at least one option
   should build on it. Write each one's name and one sentence before you draw.
7. **Write the facts down first.** Before you touch the page, write
   `<work>/build-shape-notes.md` (it is never published, and never goes in a repo). Think
   here, not on the page. For each option, list every fact a reviewer could need,
   with no length limit and no style rules: what it builds on, what is new and why,
   how it handles the hard part, every risk, limit and side effect you found, any
   existing feature or earlier plan it overlaps with, and what backing out costs.
   For each risk, note how likely a senior reviewer is to raise it.
8. **Build the page** (see "Page" below) from the notes. Write it to
   `<work>/page/index.html` as one self-contained file. The page is a selection
   from the notes, not a new draft: choose the bullets a reviewer most needs to
   decide, with the risks they are most likely to raise first. Rewording is fine;
   changing a fact is not.
9. **Edit for plain language.** Do the self-edit in
   `reference/technical-writing.md`. This pass changes wording only. If a rule
   seems to force you to drop a decision-relevant fact, keep the fact and find
   plainer words for it.
10. **Compare against the notes.** Reread `build-shape-notes.md`. If a risk a
    senior reviewer would likely raise is missing from the page, put it back, in
    place of a weaker bullet.
11. **Check.** Run `python3 .claude/skills/build-shape/scripts/check.py <page>` and
    fix every problem it lists. Then confirm each existing part has a real path or
    resource, no option is filler or a variant of another, and every option answers
    the hard part and names its risks.
12. **Render.** Open the page with `agent-browser` (headless Chromium) at 1440px
    wide and screenshot each option. Fix any label that crosses a box edge or is
    clipped, by making the box bigger, and screenshot again.
13. **Publish** with the `artifacts` skill (`.claude/skills/artifacts/SKILL.md`):
    `.claude/skills/artifacts/scripts/publish.sh <work>/page <feature>-build-shape`,
    for example `email-outreach-build-shape`. Pass `--update` when you republish.
14. **Post back.** Comment on the ticket (and reply in the Slack thread, if one
    asked) with the artifact link, one line per option, and the one or two risks a
    reviewer should look at first. Say that viewing needs a Good Party Vercel
    sign-in.

## After the pick

When reviewers pick an option, record the pick, who made it and their reason in a
ticket comment. Then republish (`--update`) with only the chosen option on the
page. That page plus the ticket is the build direction for the agent that
implements it.

## UX mode

`ux-review-options` runs this skill to give each UX option a "How it's built"
panel. In UX mode:

- **Input** is the UX page source, `<work>/page/src.html`, plus the ticket. Each
  `#option-x` section there is one experience to build.
- **One build per UX option**: the most credible way to build that experience, not
  two or three. The rules, research and notes above still apply.
- **Output** is one fragment per option, `<work>/build/option-a.html` (and b, c).
  No page, no publish: `ux-review-options` inlines the fragments and publishes.
- **First line** of each fragment records which option it was built for and the
  hash of that option's section, from
  `python3 .claude/skills/ux-review-options/scripts/option_section.py <work>/page/src.html option-a`:
  `<!-- build-shape-for: option-a sha256:<hash> -->`. That script defines the
  section and the hash. A change to the section makes the fragment stale, and the
  UX check then fails until you rebuild it.
- **Markup**: a `<section class="build-shape">` holding `<h3>How it's built</h3>`,
  the change count, "The change" sentence, the legend, and one `.screen` with the
  `.map` and `.rail`, the same markup and classes as the option section in
  `assets/page-template.html`. No `<style>`: `ux-review-options` adds
  `assets/ux-panel.css` once, scoped to `.build-shape`. Give each map's arrow
  marker its own id (`bs-arr-a`), since all fragments share one page.
- **Check** each fragment with `scripts/check.py <work>/build/option-a.html`. It
  also has to pass the UX page check: its banned words and spacing rules apply.
  The Win and Serve vocabulary check skips `.build-shape` sections, because they
  name systems (the voter file, election data) for staff, not users.

## Page

Copy `assets/page-template.html` and fill it in. Keep its CSS, layout, legend and
section order exactly. Do not restyle it, add sections, or move the rail. One static
HTML file, no scripts, no external requests.

Top of the page, and nothing else above the options:

1. **The job**, one sentence.
2. **Not doing**, one line on what is out of scope, from the input or from the
   options you ruled out. Skip it if nothing is.
3. **Today**, two or three plain sentences on how this works now (see Audience).
4. **The hard part**, one or two bullets.
5. **Legend**, as in the template: Unchanged, Changed, New, and Removed only if a
   map removes something. It floats at the top of the screen while scrolling.

Then one section per option (`#option-a`, `#option-b`, `#option-c`). Each is one
screen: the map on the left, the rail on the right.

1. **Name** (two or three words), then the **change count** under it ("3 new, 2
   changed, 1 removed", counting the parts on the map), then **the change**: one or two sentences on what
   changes compared with today.
2. **Map** (left, `.map`). An inline SVG, `viewBox` 940 wide, as tall as it needs.
   It is the main thing on the page. Use the template's CSS classes, never inline
   colors.
   - **Spend the map on what changes.** Most of the area goes to the new and
     changed parts and the flows between them. A part that only gains a new case on
     an existing paved path (a new enum value, one more tile, one more prompt) is
     unchanged: fold all such parts in one system into a single small `unchanged`
     box, for example "Outreach flow: compose, AI draft, spine (adds email type)".
     If a reader's eye lands first on something that is not changing, the map is
     wrong.
   - **Systems contain their parts.** Draw each deployed system (gp-api, gp-webapp,
     gp-admin, a worker, the agent runtime, a vendor or cloud service) as a
     container (`rect.sys`, title `ct`, subtitle `cs` saying where it runs). Its
     parts sit inside it. Containers are not in the legend; they only group.
   - **Each part is one of four states**, class `unchanged`, `changed`, `new` or
     `removed`, matching the legend. Title in `bt`. A new part's title starts with
     "New".
   - **Every word earns its place.** A detail line (`bs`) is optional. Keep it only
     if a reader with two minutes learns something from it: a real path, or what
     changes in plain words. Never internal shorthand like "next send time, close on
     ingest".
   - **Every arrow is labeled** (`al`) with what flows, in plain words.
   - Never shrink text to fit. Make boxes bigger instead. Labels must not cross box
     edges.
   - Keep the same position for the same system across options.
3. **Rail** (right, `.rail`), in this order, all as real bullets. Bold (`<strong>`)
   the one detail per bullet that matters most for the decision, where there is one:
   - **Builds on:** existing parts, platform services and vendor features it reuses.
   - **New:** each new table, service, queue, dependency or credential, with a few
     words on why. "Nothing new" is a valid answer.
   - **The hard part:** one or two bullets on how this option handles it.
   - **Risks and objections:** two or three bullets. Known limits it runs into
     (latency, cost, rate limits, access), side effects on existing behavior, and
     the choices a reviewer is most likely to overrule, phrased as questions.
   - **Cost to back out:** start with **Two-way door** (we can undo it cheaply) or
     **One-way door** (data, contracts or vendors we cannot easily walk back), in
     bold, then one sentence on what we would throw away.

Nothing else on the page: no building-blocks summary, no closing summary, no
recommendation, no open questions list, no timeline.

## Style

Plain US English, short sentences, sentence case headings, no em dashes, no emoji.
Use the product's real names for things. Write for a reviewer who knows our system
in broad strokes but not this corner of it.
