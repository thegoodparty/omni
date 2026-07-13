---
name: create-tdd
description: Write a GoodParty Technical Design Doc (TDD) for a big-rock feature: a human-reviewable design of the system changes, posted to the ClickUp TDD folder, with deeper detail split into an Implementation Notes subpage. Use when the user wants to design a feature, write a tech design / design doc / TDD, or turn a scoped problem into a reviewable technical design. Not for small features or bugs.
---

# Write a GoodParty Technical Design Doc

A TDD is the artifact the team reviews **synchronously, in one ~1-hour call, aiming
for one round**. It is the primary quality gate for big technical decisions (code
review is mostly automated here). That sets everything below.

The standard is written down in _How We Build Features_, and the agent's job is to
**comply with it, not fight it**: "a document a human being can read completely in
15 minutes," and "a TDD is **not** an implementation plan; it's a description of the
system changes being proposed, with the key choices highlighted." The named failure
mode there is _"a 15-page, fully AI-generated TDD"_ and _"AI-generated technical
design docs that hide the absence of thought."_ Left unchecked you will produce
exactly that. Don't.

## Gate: is this even a TDD?

TDDs are for **big rocks only**. Rough test (theirs): does the work touch **more
than one system, or more than one team's surface area**? If no (a one-screen UI
change, a bug, a small feature), there is no TDD. Say so and route it to the pod's
normal queue. Don't manufacture ceremony.

## Process (the human owns the thinking)

1. **Brainstorm first.** If the `superpowers:brainstorming` skill is available,
   run it before drafting. Never produce the full doc before the dialogue; that's
   how you get the 15-page nobody-thought-about-it doc.
2. **Surface the forks; let the human decide.** Your value is finding the real
   design decisions and arguing the tradeoffs, not resolving them. Put load-bearing
   forks to the human as explicit questions (use AskUserQuestion), recommend a
   direction with reasoning, and let them choose. The human mind is the point of a
   TDD; you are assistance.
3. **Draft, then cut.** First pass tends long. Cut toward the 15-minute gate (below)
   by _relocating_ depth to the Implementation Notes subpage, never by deleting it.

## The Orange bias (apply to every component)

GoodParty is a **pre-PMF startup**. On a Red→Violet scale (Red is "one dev yoloing
vibe-code to prod," Violet is "AWS/Google battle-tested and bulletproof") we are at
**Orange**: lean, simple, reuse what exists. For each piece of the design ask "what's
the simplest thing that works at Orange?"

- Strongly prefer **reusing existing infrastructure** over introducing new.
- Any **new** infra, dependency, table, or service must be **explicitly justified**.
- Hide risk behind flags / manual cohorts; ship dark, validate, then ramp.
- If you're taking on tech debt, **name it out loud** in the doc.
- Make reuse-vs-new visible so a reviewer can see where complexity is being added.

## What goes in each section

Follow the existing template (don't restructure it). What belongs in each:

- **Summary**: 2-4 sentences, prose. What we're building and why. No decision list,
  no bullets. Link the prototype, the scope doc, and any related TDDs (e.g. a
  dependency design).
- **Scope / Not in this doc**: what this covers and what's deferred or owned
  elsewhere. If a separate scope doc exists, link it and note only the deltas.
  If the source PRD or scope doc phases delivery (MVP, Phase 1/2, dated
  checkpoints), carry those milestones through here so they survive into epic
  creation; if it specifies none, don't invent any.
- **Proposed Solution**: the bulk of the doc. **Decompose into the 2-5 real
  subproblems and give each its own subsection.** Organize by subproblem, _never_
  by repo/stack. Per subproblem, include the load-bearing detail and nothing past
  the decision:
  - **Full Prisma models** for new/changed tables (always; schema is design).
  - The **shape** of any contract crossing a service boundary (the shape, not every
    field; field-level contracts go to the subpage).
  - The **key choice and why**. A **diagram** where the data flow isn't obvious.
- **API surface**: a single table of new endpoints: `method & path | purpose |
consumers | MCP-enabled?`. Cheap to write, and it makes the access patterns legible
  at a glance. Mark which endpoints are exposed as MCP tools for agents.
- **Key Takeaways**: bulleted. The load-bearing decisions a reviewer must leave
  with. **Decisions live here, not in the Summary.**
- **Alternatives Considered**: work from 2-3 genuinely distinct approaches before
  settling, not just a record of what you rejected. Distinct means a real fork
  (sync in the request path vs queued async; extend an existing table vs a new
  one), not bikeshedding (library X vs Y). A short paragraph each: what it is and
  why it lost. The recommendation needs reasoning a reviewer can argue with, not
  just a vote. If there is only one reasonable approach, say so explicitly in one
  line; manufactured options waste the reviewer's time and dilute trust.
- **Open Questions**: genuine unknowns, and things deliberately deferred to
  implementation. Reviewers add to this during the call.

## Cross-cutting prompts (answer each, even if N/A)

Reviewers consistently ask about these four. Answer each in whichever section
fits, as prose, not mandatory tables. "N/A because <reason>" is a valid answer;
silence is not.

- **Inputs and outputs**: what flows in (requests, queue messages, user actions)
  and out (responses, events emitted, persisted state, side effects). Name which
  inputs are user-controlled.
- **DB changes**: the Prisma models rule covers the change case; when there is no
  DB change, say so and why.
- **Failure and recovery**: what failure looks like, its blast radius, and how we
  recover (bad deploy, external API outage, queue backlog). A stateless read-only
  feature can say exactly that in one sentence.
- **Data flow**: the diagram plus one prose paragraph of the flow. For a simple
  flow a mermaid block in the doc is enough; for anything bigger, author
  `scratch/<feature>/<feature>-data-flow.drawio.xml` (plain XML, renders in
  diagrams.net or the VS Code Draw.io extension) as the editable source of truth
  and attach an export to the ClickUp page. One canonical diagram: services, data
  stores, queues, external APIs, and the user, with every edge labeled by what
  flows. No internal classes.

## Two tiers: the TDD and the Implementation Notes subpage

The tension: trimming for reviewability would throw away detail that's useless in
review but **essential during planning**. Solution: a second page. **Relocate, never
delete.**

- **Main TDD (the review artifact):** Prisma models, contract shapes, the data-flow
  diagram, the API surface table, the decisions, the alternatives, and the
  reused-vs-new callouts.
- **Implementation Notes (a ClickUp child page of the TDD):** full field-level
  contracts, validation/upsert step lists, edge-case handling, the template's
  "Optional" material (metrics, alerts, "should never happen," cost estimates, abuse
  prevention, example test sets), and detailed prompt designs. This is also where
  reviewers "drop into" when a question goes deeper than the TDD.
  Also include a **Codebase context** section carrying what you learned during
  recon, so the planning agent doesn't re-derive it: the existing patterns to
  extend and the seam where new code lands, each with a short (5-15 line) excerpt
  of the real code (a file path alone doesn't transfer the pattern), plus where
  similar tests live and any pain points to avoid (deprecated dirs, in-progress
  migrations). Excerpts come from the actual repo scan, never from memory.
- **Omit (or subpage) unless genuinely novel:** UI layout and component detail.
  Specify a UI interaction only when the _interaction model itself_ is the hard part.
  Never restate what the code already shows. Never write implementation that
  pre-empts the planning phase.

Altitude rule: specify the **decision and its constraints**, not the implementation.
If a competent engineer plus a planning agent could derive it, leave it out. **Under-
specified is acceptable; over-specified is the failure mode.**

## Length and style gate

- **15-minute read.** As a heuristic, keep the main TDD to **~2,500 prose words or
  fewer** (excluding code blocks and diagrams). Before declaring done, estimate the
  prose word count and reading time; if it's over, move depth to Implementation Notes.
- **No em dashes** (org style). Terse bullets, bold sub-labels, complete sentences.
- Write for a human reviewer skimming on a deadline, not for a parser.

## Where it goes (ClickUp)

TDDs live in the **Technical Design Docs folder**: parent page `2ky4jq2q-81493`, in
doc `2ky4jq2q-20493`, workspace `90132012119`. The section template is page
`2ky4jq2q-81513` (read it for the current skeleton).

Keep a local working copy under `scratch/<feature>/` and mirror to ClickUp through
the **ClickUp MCP server** (configured in `.mcp.json`, authorized via OAuth, see
`docs/mcp.md`). There is no ClickUp API token in this repo; don't shell out to the
REST API.

ClickUp is **read-only by default** (`docs/mcp.md`): reads are free, but **ask the
user before creating or updating any page**, and **read the remote page first** before
an update so you can surface any human edits instead of clobbering them.

- Read the template page `2ky4jq2q-81513` for the current skeleton.
- Create the TDD page in the folder: a ClickUp MCP create-page call with
  `parent_page_id` = the TDD folder (`2ky4jq2q-81493`).
- Create the **Implementation Notes** page as a **child of the TDD page**
  (`parent_page_id` = the TDD page id from the step above). Cross-link the two.
- Update a page: read it, diff against your local draft, confirm with the user, then
  update.

## Before declaring done

- Big rock confirmed; otherwise no TDD.
- Brainstormed with the human; the load-bearing forks were **their** calls.
- Summary is prose; the decisions are in Key Takeaways.
- Proposed Solution is decomposed by subproblem.
- Prisma models, contract shapes, a diagram (if flow is non-trivial), and the API
  surface table are present.
- Alternatives are genuinely distinct with a reasoned recommendation, or
  explicitly collapsed to one.
- The four cross-cutting prompts (inputs/outputs, DB changes, failure/recovery,
  data flow) are each answered or explicitly N/A with a reason.
- Milestones from the source PRD/scope doc carried through; none invented.
- Reuse-vs-new is visible; any new infra is justified (Orange).
- Deep detail was **moved to Implementation Notes**, not deleted; Implementation
  Notes carries Codebase context with real code excerpts.
- Main TDD is ~15 minutes / ~2,500 prose words or fewer; no em dashes.
- Posted to the TDD folder; Implementation Notes subpage created and cross-linked.
