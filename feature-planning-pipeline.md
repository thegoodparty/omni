# Feature planning pipeline (initiative doc)

## The anchor (re-stated 2026-09-14, keep coming back to this)

Three things, in order. Every rule, format and tool in this pipeline exists to
serve them, and anything that does not serve them is decoration.

1. **A holistic understanding of the feature and the ask** — what it is, how it
   must work, and what it would actually take to accomplish it. Not an inventory
   of the screens.
2. **Human questions surfaced up front and answered up front**, so they do not
   surface mid-build.
3. **That same understanding feeds the TDD and the implementation plan.** The
   model is the spine of the whole pipeline, not a gate on one skill.

   Mechanically: `/create-scope` writes `scratch/<feature>/model.md` FIRST and the
   scope doc on top of it, so scoping is grounded in the reasoning rather than the
   reverse. The scope doc carries a short purpose blurb at the top, pointing back
   at the model. `create-tdd` then reads the model for the chains, invariants,
   integration and vendor facts; the implementation plan reads it for the effects
   and the order things must exist in. It is updated as the design changes, never
   regenerated, so the decisions recorded against it stay attached.

DRIFT WARNING, observed twice in one session. Rules about output formatting
accumulate faster than rules about thinking, and the reasoning step starves: the
model went 345 lines, then 200, then vanished entirely into a section of the scope
doc placed after the index — at which point the findings were chosen before any
reasoning happened. If you are about to add a formatting rule, check the thinking
step still has weight.

SECOND DRIFT WARNING. Writing instructions and writing a test are different jobs.
Eight of this skill's worked examples were real findings from the feature being
tested, so three "blind" runs were reading the answers out of the instructions.
Illustrate a rule with a generic pattern, never with the answer to the thing you
are about to measure.

## Purpose

Turn our manual scope -> TDD -> implementation-plan -> build pipeline into
reusable agent skills, with fast human review gates at the points where a wrong
assumption would compound.

Three outcomes, in Stephen's priority order. Speed of authoring is a side
effect, not the goal:

1. Stop missing things. We already plan thoroughly and things still slip
   through, surfacing mid-build when they are expensive. The pipeline should
   make omission structurally hard, so everything that needs agreement is
   agreed up front.
2. Plan for parallel execution. The implementation plan must let a swarm of
   agents build in hours instead of days, which means genuinely independent
   work units, not a list of tasks.
3. Pixel-perfect UI in one pass. Match the design first time, without a human
   acting as the diff tool and sending work back.

A fresh agent should be able to read this doc and pick up the work. Start with
the kickoff prompt at the bottom.

## What Stephen is hoping to achieve (his words, verbatim)

> I want to see how we can improve execution time in projects like the one we
> did. Planning, mapping code changes, planning migratiions, and pulling in
> designs from claude design into the project, etc.
>
> We have been doing it sort of manually like:
> - Have a person walk through the designs and try to map out the scope.
>   Sometimes there are requirements that aren't specifically stated from the
>   designs and imperative in how it would work.
>   We try to use our experience in product building and come up with a list of
>   scope for every page and section of a feature - to get explicit agreement on
>   each bit of functionality and how it will work, plan for any empty states,
>   where data will come from, any new integrations, etc.
>   We end up with a sort of list for each page and section with a bullet list
>   of things in scope and out of scope, for discussion and approval by product
>   team.
> - Once we have the scope defined, we do a full TDD - tech design document,
>   where we plan out technically how it will work.
>   I think it is helpful to have 2 versions. 1 for getting high level buy in on
>   the design from other engineers. and 2 for an indepth implemenation plan to
>   give to an agent. The two should match, but the first one is mostly about
>   schema, architecture design, and any technical parts that are important to
>   have buy in from the other engineers.
> - We do a design design of the TDD. Then we build.
> - I do think that our implementation plan should be made so that the work can
>   be done in parallel by many agents at once for maxium implementation speed.
>   I think the implementation plan should be designed to have everything done
>   in paralell. Anything that all agents will need, like database schema or IAC
>   should be done first so all others can use it.
> - When doing the UI, we need to match it pixel perfect to the designs.
>   Previously we used loveable and I could give an URL and I had a skill ui
>   clone that would map all the changes needed and it generally made pixel
>   perfect implementations of the designs in the product. However, after
>   switching to claude design, that no longer works and it's a struggle.
>
> I was thinking maybe if there was some way to automate these parts and have
> human review at crucial parts, but if it could be automated, it would increase
> development speed.

## Principles we agreed on

- The durable asset is the captured judgment, not the automation. The valuable
  part of the current process is the implicit checklist applied from product
  experience (every page needs empty states, error states, loading, permissions,
  a named data source, integrations called out, and so on). An LLM applies a
  good checklist exhaustively and invents a bad one. So the first job of each
  skill is to make that checklist explicit.
- Derive the checklist from misses, not just from good docs. A scope doc we
  liked shows what we remembered. The features where something got missed show
  what the checklist is still lacking. The checklist ratchets: every real miss
  becomes a permanent line item, so it improves over time instead of being
  frozen at whatever we guess up front.
- Coverage is enforced mechanically; the artifact stays readable. Absence is
  invisible in prose, so underneath, coverage is a matrix (every section against
  every checklist dimension) and an unfilled cell fails the gate. But nobody
  agrees on a spreadsheet. The document people read stays per page and per
  section, in scope / out of scope, close to what we write today. Items are
  tiered so review is fast: DEFAULT APPLIED (standard pattern, collapsed),
  DECISION NEEDED (real choice, pulled to the top), ASSUMPTION MADE (agent had
  to guess, pulled to the top). The reviewer reads the top block, not the whole
  document.
- Don't remove the human gates, make them fast. The slow step today is getting
  explicit agreement, not authoring. Each skill's output should be
  decision-ready: every item a yes / no / modify line, and anything the agent
  had to assume flagged as an explicit open question rather than silently
  guessed. Turn a two-day authoring effort into a 20-minute review.
- Plan quality determines parallel build speed. Parallel agents only go fast if
  the work units are genuinely independent. The moment two units share a file or
  an undefined contract, they collide and the speedup is lost to rework. So the
  implementation plan is authored as a dependency graph, not a list.
- Work from real examples, not blank templates. Stephen's judgment is tacit
  ("I have ideas but I'm not sure how to verbalize them yet"). So for each skill
  we start from a real artifact he considers good, reverse-engineer the template
  and the hidden checklist from it, and he reacts to a concrete draft. He should
  never be asked to specify his judgment in the abstract.

## What we're building (REVISED 2026-09-10)

Supersedes the original "three new skills" plan. After auditing the commands a
teammate already built (`/create-tdd`, `/clickup-epic-create`, `/work-on-epic`,
`/work-on-clickup`, `/validate-feature`, plus the `gp-feature-validator`,
`gp-ui-tester` and `gp-reviewer` agents), the back half of this pipeline already
exists and works. We build the FRONT half and upgrade three existing pieces,
rather than building a parallel chain.

### The full pipeline

| # | Component | Status | Gate | Gap it closes |
|---|---|---|---|---|
| 0 | Token reconciliation: close the ~40 drifted/missing token values in `packages/styleguide` | one-time setup | none | Pixel-perfect drift. Do this FIRST or every build unit re-fights it |
| 1 | `design-digest`: `fetch_design.py` + analysis, producing a committed artifact (flow structure, component tree with DS names/props/tokens, copy, state signals, gates, `isMobile` branches) | NEW (shared script) | none | Nothing in the chain reads the design at all |
| 2 | `/create-scope`: digest (+brief) to per-page/section in-scope & out-of-scope, coverage matrix, tiered decisions, integration register | NEW | product | In/out scope agreement, per-section granularity, data source per element, empty/loading/error AT PLAN TIME, unstated requirements, missing integrations |
| 2.5 | **Vendor spike (new integrations only)**: a POC that verifies every capability the design depends on, against the real API. GATES the TDD — see below | NEW | go/no-go | Architecture built on unverified vendor assumptions. Cost us months on robocall |
| 3 | `/create-tdd`: accept an approved scope doc as input (not just a PRD); consume the digest for gates, state shape, integrations; carry the integration register forward | EXTEND | engineers | Already strong. Needs the scope doc as its typed input |
| 4 | `/clickup-epic-create`: emit authoritative `dependencies`, files-to-touch and AC; attach the UI spec to UI tickets; stamp the side-effect class on every integration ticket | EXTEND | Stephen | Stops `work-on-epic` having to infer the graph; carries the pixel-perfect spec into the build |
| 5 | `/work-on-epic`: parallel executor | REUSE as-is | PR review | Already covers foundation-first, work-unit independence, hours-not-days |
| 6 | `/validate-feature`: replace raster artboard comparison with source-derived token/prop assertions; a failed design read becomes a HARD STOP, not a silent skip; enforce the side-effect gate | UPGRADE | approve before filing | Turns pixel-perfect from post-hoc discovery into confirmation |
| 7 | Checklist ratchet: every bug `/validate-feature` files for a missed state becomes a permanent row in the scope checklist | NEW (small) | none | Nothing feeds misses back today; this is the part that compounds |

Build order: 1, then 2, then run both on the pilot feature, then 3, 4, 6, 7.
Item 2.5 only fires for features with a new vendor integration.
Item 0 is repo-side and can run in parallel with any of it.

Working drafts (contents of each piece, as we iron them out):
- Item 2 checklist: `scope-checklist-v0.md` (draft, under review)

### Audit: what their chain already covers, and what it misses

Measured against the failure modes Stephen named (see his verbatim section
above).

Covered: human review gates; foundation (schema/IAC) first; genuinely
independent work units (files-to-touch plus producer/consumer heuristics); two
TDD tiers that cannot drift ("relocate, never delete"); assumptions surfaced as
explicit open questions; parallel execution.

Partial: new integrations are called out at architecture level, not per section.

Missing or back-loaded:
- Requirements implied but unstated in the designs. The chain starts at a PRD
  and never reads the design.
- Explicit in-scope / out-of-scope agreement as a product-facing artifact.
- Per-page, per-section granularity (their tasks are engineering units).
- Data source per element (they cover system-level I/O only).
- Empty / loading / error states, which are checked at VALIDATION time.
- Pixel-perfect, which is a raster comparison after the build and can silently
  skip.
- A ratchet. Nothing feeds a caught miss back into the checklist.

THE KEY FINDING: their own tooling states our diagnosis. `gp-feature-validator`
step 6 says "Check the states specs commonly skip: loading, empty, and error
states", and `gp-ui-tester` step 4 lists the same plus form validation,
responsive at narrow width, and keyboard/focus. THAT IS THE HIDDEN CHECKLIST,
already written from real failures, sitting at the wrong end of the pipeline.
They catch these in a browser after the code exists; we want the spec not to
skip them. So DO NOT INVENT the scope checklist. Harvest it from those two
agents and move it to the front.

### The scope/TDD contract

Scope doc = shared understanding of THE ASK, from product's design. Every product
decision is resolved there, up front.
TDD = HOW we do it technically. No product decisions. A product decision
appearing in the TDD means scope was incomplete.

Two mechanisms make that real rather than aspirational:
1. `/create-tdd` checks the scope doc for unresolved decisions and REFUSES to
   run while any remain. Without this an engineer writing a TDD simply answers
   the open question instead of stopping, and the product decision gets made by
   whoever happened to be typing.
2. A product question that surfaces DURING the TDD is not answered there. It
   bounces back as a scope amendment.

The one honest exception: some product decisions cannot be made until a
technical constraint is known. "Bill the estimate or bill actuals?" is a product
call, but it is unanswerable until you know CallHub cannot report actuals. That
is why the vendor spike (item 2.5) sits BETWEEN scope and TDD — it resolves the
unknown, product then decides, the scope doc is amended, and the TDD proceeds.
The chain is not strictly linear; the spike is what absorbs that.

Consequence for the checklist: any row product cannot answer does not belong in
the scope doc. That test moved six items out of the product gate (see
`scope-checklist-v0.md` part D), and moved "what are we measuring?" back IN,
because what counts as success is a product decision.

### Vendor spike: a go/no-go prerequisite, not a work unit

Applies whenever a feature depends on an integration we have not used this way
before. It runs BEFORE the TDD is locked and can invalidate the design, which is
why it is a gate and not a ticket.

Why it gates the TDD rather than the build: robocall's billing architecture was
designed around what CallHub was assumed to do. When that turned out to be
false, the architecture had to change, producing months of rework across two
migration branches (CallFire and estimate-billing) plus a BigQuery probe. A
spike before the TDD would have produced a TDD written against verified reality.

THE PATTERN, from our own failures: every robocall vendor failure sat at the END
of the lifecycle, and all were found at the end of the project.
- CallHub's export endpoint never worked
- `getVoiceCampaignUsage` omits the required `start_date`, so the count read fails
- CallHub cannot return per-campaign connected results at all
- The Stripe account was never enrolled for extended authorization
Create and launch worked fine. You verify what you build first, you build the
happy path first, so reconciliation is the last thing touched and the first thing
wrong.

So the spike exercises the endpoints you will need LAST, FIRST.

What it must prove:
- Every endpoint across the FULL lifecycle — results, export, reconciliation and
  settlement, not just create and launch.
- That the vendor returns the SPECIFIC data the design displays. For robocall
  that was the Answered / Voicemail / No answer breakdown, not merely a 200.
- Account, plan and enrollment state. Stripe's extended authorization failed on
  enrollment, not on code.
- The test path (sandbox / override / none), which feeds the side-effect class
  in the integration register.

Output: a short verified/not-verified table per capability, attached to the
scope doc's integration register. A capability the design depends on and the
spike could not verify is a GO/NO-GO for product and engineering together, not
a risk note.

Relationship to the scope doc: `/create-scope` NAMES the dependency and marks it
unverified (row 25). It does not do the verification — that takes days and cannot
happen inside a product review. Naming it is the cheap part and the whole win,
because the failure mode being fixed is that the dependency was invisible.

### Integration safety (side effects have no undo)

Two problems: scoping must surface integrations that are missing or have no test
path, and testing must never fire real-world actions. `/validate-feature` drives
a real browser against a DEPLOYED app, and `/work-on-epic` agents run smoke
tests, so either can hit a Send button. This must be structural, not a warning.

Integration register, produced by `/create-scope`, one row per integration
(which also forces naming the ones that do not exist yet):
name; new or reuse; sandbox available; test path (sandbox / override-gated /
none); if override-gated, EXACTLY what the override covers and what it does not;
irreversible side effects (contacts a real person / spends money / writes
external state / sends to a third party); blast radius; credential owner.
A row with no test path is a BLOCKING open question, not a note.

Side-effect class, stamped on the register and carried onto every downstream
artifact:
- Class A, sandboxed: validate freely.
- Class B, override-gated: the agent must ASSERT the override is live and PROVE
  its coverage before exercising, and may use only approved test targets (for
  robocall, 804-222-1111).
- Class C, no safe path: drive up to the boundary, NEVER fire the terminal
  action, mark manual-verify with repro steps.
- UNKNOWN DEFAULTS TO C. An integration is A or B only when someone has verified
  it and recorded the evidence. This inverts today's default, where an agent will
  happily click the button.

Why "there is an override" is not sufficient, with our own worked example:
robocall's `TEST_OVERRIDE` gates the dial but NOT materialization, so it still
writes `ContactInteractionRobocall` rows for the real uncalled audience. The
override looked complete and was not. Hence the register records what an
override COVERS, and Class B requires proving coverage rather than trusting a
flag. This is also the first row for the ratchet: "an override covers the
visible action but not its side effects."

Cheapest version that still works: the register is one table, the class is one
field that travels with every downstream artifact, and enforcement is a single
check an agent runs before any state-changing action, rather than judgment
spread across four skills.

### Where the skills live

Still open. `packages/runbooks/commands` holds the teammate's slash commands and
`omni/.claude/skills` holds `create-tdd`; new work should match whichever the
extended commands use. Does not block anything.

## Tracks

The planning chain (the three skills) and UI parity are independent and run in
parallel. Pixel-perfect UI is one of the three core outcomes, so it is no longer
deferred behind the planning work.

Still later: wiring the parallel build orchestration end to end.

UI parity, current state: SOLVED at the extraction layer. The export on hand is
`Voter Outreach (standalone) (1).html` at the omni root, 1.8MB. It renders via a
JS bundle, but the full design SOURCE is recoverable without rendering at all:

- `<script type="__bundler/manifest">` holds every asset as gzip+base64. Decode
  and gunzip to get the JS bundles and the woff2 fonts.
- `<script type="__bundler/template">` is a JS string literal (NOT valid JSON,
  it has unescaped quotes in `data-props`, so `json.loads` fails; unescape
  manually). Inside it, the `text/x-dc` script is the design source: 643KB,
  5,841 lines of readable React.createElement code.
- One decoded bundle is the GoodParty design system itself, with a component
  manifest naming each component and its sourcePath
  (`components/actions/Button.jsx`, etc).
- The design source references styleguide tokens directly as CSS custom
  properties (`var(--color-primary)`, `var(--gp-waxflower-50)`).

This changes the approach. Parity is not a raster diff or even a geometry diff.
The design and our app are both composing the SAME design system components
against the SAME tokens, so parity becomes a source-to-source mapping problem:
map the design's DS component calls onto our styleguide components and diff the
props and tokens. A geometry diff (render the export from `file://` with
Playwright) stays available as verification, but it is the check, not the
primary mechanism. Note the export pulls React from unpkg, so an offline render
needs those two files vendored locally.

Working extraction script and decoded output live in the scratchpad; re-derive
with the steps above.

### Access route: the size cap is not the real blocker

The 256 KiB cap on `DesignSync.get_file` is a CONTEXT limit, not an access
limit, and it is mostly a red herring. The problem splits in two, and only one
half is actually blocked.

Half 1, the design system: FULLY SOLVED, no export needed, ever.
`DesignSync.list_projects` returns "GoodParty.org Design System 3.0"
(projectId `bd9cd0d6-1239-41a9-8c7f-980fae69ea86`; the `bd9cd0` prefix matches
the `GoodPartyOrgDesignSystem20_bd9cd0` namespace embedded in the export, which
confirms they are the same system). Every file is small and reads cleanly:

- `tokens/palette.css`, `tokens/semantic.css`, `tokens/typography.css`,
  `tokens/fonts.css` — exact token values
- `components/<group>/<Name>.d.ts` — exact prop contracts per component
- `components/<group>/<Name>.prompt.md` — per-component usage rules written
  FOR agents
- `SKILL.md` — the design system ships its own agent skill (`goodparty-design`)
- `_ds_manifest.json`, `styles.css`, `guidelines/*.card.html`

This is the highest-value half for pixel-perfect output and it is live, current,
and needs no export. Feed the `.prompt.md` and `.d.ts` files to build agents.

Half 2, the specific design (the Voter Outreach screens): STILL BLOCKED, but not
by size. `DesignSync` only lists design-SYSTEM projects the user can write to. A
regular design project is not exposed at all, so chunked reads would not help
even if the API offered them. Options, unresolved:
  a. Publish the design so it has a URL, then `Artifact` read, which saves large
     pages to a local file rather than returning them inline. Needs testing
     against a real claude.ai/design URL.
  b. Keep the manual export. Now much less painful, since extraction to a spec
     is fully scripted. Costs one UI action per design revision.
  c. Product ask: expose regular design projects to DesignSync.

### TESTED against the live design project (2026-09-10)

Design project: `db901089-c99e-4063-bf79-c3344c959704` ("Master", owner Eugene GP,
`type: PROJECT_TYPE_PROJECT`, canEdit true).

Discoverability gotcha: `list_projects` does NOT return it, because that method
filters to design-SYSTEM projects. But `get_project` / `list_files` / `get_file`
all work when you address the project by ID directly. So regular design projects
ARE reachable; they are just not listable. Keep the project ID handy.

What reads cleanly today, live, no export:
- `_brief.txt` — the full ClickUp feature brief (problem, proposals, VoC quotes,
  phased in/out scope, metrics, "what not to claim", vendor-API appendix). This
  is a REAL reference artifact for the scope skill.
- `CLAUDE.md` — the design project's own agent rules. Already encodes
  "never invent, STOP and ask or list it as an open question" and "DS components
  over hand-rolled markup". Strongly aligned with this pipeline's principles;
  reuse its language.
- `_ds/goodparty-org-design-system-2-0-<id>/tokens/*.css` — design tokens.
- The separate design-system project (3.0) — every component with `.d.ts` prop
  contracts and `.prompt.md` agent usage rules.

What does NOT read: `Voter Outreach.dc.html`, the actual flows.
- Response came back `"truncated": true` at 261,646 bytes (cap 262,144).
- ZERO campaign flow methods survived. `flowCfg`, `flowPurpose`, `flowWho`,
  `flowWhen`, `flowWhat`, `flowReview`, `flowPayConfirm`, `flowSuccess`,
  `complianceBanner`, `flowAudience`, `flowCost` are ALL absent.
- The flow layer begins around 44% through the source and the read never gets
  near it. The only robocall content delivered is the Pro-gate upsell copy.
- `Voter Outreach (standalone).html` is also in the project but is 1.8MB, so it
  truncates far worse.

THE GENERATED IMPORT PROMPT IS BROKEN, AND SILENTLY. Claude Design emits an
import prompt that says "the whole project is readable" and lists files to read,
ending with "Implement: `Voter Outreach.dc.html`". Tested 2026-09-10: two of its
eight files truncate.
- `Voter Outreach.dc.html` — truncated, ZERO flow methods delivered. The file
  the prompt says to implement is the one that does not arrive.
- `_ds/.../_ds_bundle.js` — truncated at 262,028 bytes. Less severe: all 86
  components still have implementations in the delivered slice, tail lost.
- The other six (styles.css, 4 token files, support.js) are small and fine.

The danger is the silence. `get_file` DOES set `"truncated": true`, but it does
not error. An agent that ignores the flag receives a large, syntactically
plausible file and implements against ~40% of the design with full confidence.
This is very likely what happened on the earlier robocall attempt.

TWO BUGS TO REPORT, not one:
1. `get_file` needs a range/offset parameter (or a higher cap).
2. The generated import prompt should not claim the project is readable without
   checking file sizes against the cap. This is the more dangerous of the two,
   because it is what makes the failure invisible.

HARD RULE FOR THE SKILLS WE BUILD: every `get_file` call must check the
`truncated` flag, and a truncated PRIMARY design file is a hard stop. Never
proceed on a partial design. This converts a silent failure into a loud one and
is the single cheapest safeguard available today.

TWO SEPARATE LIMITS, and only one is still a problem:
1. Harness context overflow: SOLVED already. The 268KB tool result was spilled
   to a local file automatically instead of into context. Large reads are fine.
2. `DesignSync.get_file`'s 256 KiB server-side cap: NOT solved. It truncates at
   the source, with no `offset`/`range`/`length` parameter to page around it.

So the product ask is small and precise: give `get_file` a range/offset, or
raise the cap. The client can already handle a large payload by writing it to
disk. Nothing else about the design project is blocked.

Until then, the options are unchanged: manual export (works, one action per
revision), or split the .dc.html in Claude Design (but see the structural note
below on why per-CHANNEL splitting is not viable).

### SOLVED: fully automatic design acquisition from a link (2026-09-10)

The 256 KiB cap is NOT a server limitation and NOT a per-file limit. It is a
per-READ cap, and Claude Code's `DesignSync` tool is a curated subset of the
real Claude Design MCP that does not expose the way around it.

- Claude Code wrapper: `get_file`, takes only `path`. Returned 261,646 bytes of
  `Voter Outreach.dc.html` with `truncated:true` and ZERO flow methods.
- Real server tool: `read_file`, takes `project_id`, `path`, and crucially
  `offset` (1-based line) and `limit` (max lines), plus `if_none_match` (etag).
  Page with offset/limit and you get the whole file.

Proven: full `Voter Outreach.dc.html` = 751,703 bytes / 6,931 lines (exact match
to the server's reported total), retrieved in 3 paged calls. All flow methods present (`flowCfg`, `flowPurpose`, `flowWho`,
`flowWhen`, `flowWhat`, `flowReview`, `flowPayConfirm`, `flowSuccess`,
`complianceBanner`, `flowAudience`, `flowCost`). The wrapper was delivering ~1/3
of the file.

HOW TO DO IT
Endpoint: `https://api.anthropic.com/v1/design/mcp` (stateless JSON-RPC; an
`initialize` handshake works but is not required for tools/call).
Auth: `designOauth.accessToken` from the macOS keychain item
`Claude Code-credentials`, populated by running `/design-login` once.
Note params are snake_case (`project_id`), unlike the Claude Code wrapper.
Working implementation: `fetch_design.py` (paging loop) — see scratchpad; move
into the skill when built.

OTHER TOOLS THE WRAPPER HIDES (may be useful later): `render_preview`,
`copy_files`, `create_support_js`, `list_design_systems`,
`get_claude_design_prompt`, `read_design_skill`, `list_comments`,
`ack_comments`, `update_sharing`, `list_members`, `get_conversation`.

MEETS THE TEAM CONSTRAINT: given a link it just works. Each coworker runs
`/design-login` once; after that there is no export, no browser profile, no
manual step, and no design-size ceiling.

CAVEATS
- This calls the MCP endpoint directly rather than through Claude Code's
  wrapper, so it depends on `read_file`'s current shape. Same documented
  endpoint and the user's own credential, but a layer the wrapper is not
  offering yet. Still worth asking Anthropic to expose offset/limit on
  `DesignSync.get_file`, which would remove the need for the direct call.
- PARSING GOTCHAS, all now handled in `fetch_design.py` (get these right or the
  output is subtly wrong):
  * Body is HTML-ENTITY-ESCAPED (`&lt;` `&gt;` `&amp;`). Must `html.unescape`.
  * Non-final chunks append a continuation notice as an extra body line
    (`…[+N bytes truncated at read_file's 256 KiB cap — … continue with
    offset=N]`), preceded by a blank line. Strip both or line counts drift.
  * Verify assembled line count against the wrapper's `total_lines`.
- HARD LIMIT, cannot be paged around: a file containing a SINGLE LINE >= 256 KiB
  is cut mid-line, and a line-count check does NOT detect it. Confirmed on
  `Voter Outreach (standalone).html`, whose line 381 came back at exactly
  262,144 bytes. `fetch_design.py` now raises loudly on this rather than
  returning quietly-wrong content. This affects MINIFIED/BUNDLED assets, not
  authored source: the `.dc.html` design source has normal lines and pages
  perfectly, as does `_ds_bundle.js` (8,672 lines / 284 KB).
- Keep the truncation-flag hard rule regardless: if any read comes back partial
  and cannot be paged, STOP rather than build against a partial design.

ROUTES RULED OUT BY TESTING (do not revisit):
- Publishing to an artifact URL. `Artifact` read rejects claude.ai/design links.
- Playwright driving claude.ai. Cloudflare blocks automated Chrome; headless is
  challenged instantly, headed with a real signed-in profile never cleared
  "Just a moment..." after 90s+.
- Splitting the .dc.html. Product owns designs; cannot require byte-capped files.
- Per-CHANNEL splitting. Structurally impossible, see below.

### SUPERSEDED (kept for history): earlier acquisition decision

Constraint that decides it: whatever we build must be easy for EVERY engineer on
the team, not just one person with a configured machine. That rules out
per-person auth setup and browser flags.

Routes tested and RULED OUT:
- Publishing to an artifact URL. `Artifact` read rejects claude.ai/design links;
  it only accepts `claude.ai/code/artifact/<uuid>`. Different surface.
- Playwright driving claude.ai. Cloudflare blocks automated Chrome. Headless is
  challenged immediately; headed with a real signed-in persistent profile still
  sat on "Just a moment..." for 90s+ and never cleared. Playwright's automation
  surface is detectable. Dead end, and it would have needed per-person login
  anyway.
- Splitting the .dc.html. Product owns the designs; engineering cannot require
  designers to keep files under a byte cap, and it is tedious and would silently
  regress.
- Extracting the OAuth token from the macOS keychain to call the API directly.
  Rejected on principle: an undocumented endpoint plus a scraped token is not a
  foundation for a team skill.

DESIGN DECISION: abstract the acquisition step; degrade gracefully.

The skill's interface is "give me the design source". How it obtains one is an
implementation detail, so:
1. Try `DesignSync.get_file`. ALWAYS check the `truncated` flag.
2. Not truncated (most designs): fully automatic, zero manual steps.
3. Truncated: HARD STOP with an actionable message — export the standalone HTML
   from Claude Design, drop it at a known path, rerun. One click, by whoever
   starts the work, once per design revision.

Why this is the right shape:
- Most designs need nothing from anyone.
- Oversized designs need one click, not a configured machine.
- It can NEVER silently build against a partial design, which is the actual
  failure that burned the earlier robocall attempt.
- When `get_file` gains a range parameter, swap step 1's implementation and
  nothing downstream changes. No bet on a fix we do not control.

Bonus property of the export path: a committed export is a VERSIONED design
artifact. Diffing two exports shows exactly what changed between design
revisions, which we cannot do today.

### MEASURED: the actual pixel-perfect gap (2026-09-10)

Question answered: can we replicate the robocall flow pixel-perfect from the
Claude Design source alone, with no Anthropic feature request? YES, after one
bounded piece of work. The gap is no longer vague, it is counted.

COMPONENTS: 97% match. 174 of the 179 components in the Claude Design system are
already exported by `packages/styleguide/src` + `packages/gp-webapp/app/shared`.
The designs are built against essentially our own kit. Unmatched (5), a mapping
table not a build: `Icons`, `ICON_NAMES`, `Logo`, `LogoWordmark`, and
`InputOtp` vs our `InputOTP` (casing).

TOKENS: this is the whole gap. Of 51 comparable light-mode semantic tokens,
28 resolve IDENTICAL, 23 differ, and 17 more that the design uses do not exist
in our styleguide at all.
- Brand core is already exact: `--color-primary` `#1e63ec` on both sides, plus
  primary-dark, primary-light, secondary, link, info, destructive-dark/light.
- Drift is concentrated where our styleguide still falls back to SHADCN
  defaults while the design uses GoodParty values:
    --color-border            design #d1d8df  vs  app #e2e8f0
    --color-foreground        design #000000  vs  app #020817
    --color-muted-foreground  design #70757a  vs  app #64748b
    --color-destructive       design #dc2626  vs  app #ef4444
    --color-accent            design #63d1a0 (halo green) vs app #f8fafc (slate)
    --color-ring              design #1e63ec  vs  app #020817
- Missing entirely (17): `input-*`, `surface-*`, `tooltip-*`,
  `border-strong`, `border-subtle`, and several `-foreground` variants.

IMPLICATION: pixel-perfect is a ONE-TIME token reconciliation of ~40 values, not
a per-screen struggle. Once closed, screens built from these designs land
correct by construction because the components already match.

CAVEAT before acting: the webapp side resolves through `var(--x, fallback)` and
the comparison read the FALLBACKS. If those variables are set at runtime
elsewhere, some of the 23 may already agree. Treat 23 as an UPPER BOUND and
confirm against the rendered app before changing any token.

VERSION NOTE: the design project binds design system 2.0; the live DS project is
3.0 (updated 2026-09-09). Re-run this comparison against whichever version the
design actually binds.

Reproduce: `fetch_design.py` for the design-side tokens
(`_ds/.../tokens/semantic.css`, `palette.css`), compare against
`packages/styleguide/src/*.css`.

### Why per-flow reads are structurally impossible (the real blocker)

Measured against the extracted source. The outreach design is NOT seven channel
flows. It is ONE parameterized flow with seven configs, so there is no
"robocall" region of the file to read on its own:

- `flowCfg(channel)` returns per-channel config for sms, email, robocall, polls,
  phone-bank, social. All of them share the same `flowPurpose` / `flowWho` /
  `flowWhen` / `flowWhat` / `flowReview` methods.
- Channel identity is a variable (`ch`) threaded through conditionals scattered
  across the whole file. Robocall has 46 mentions spread over line buckets 0,
  1000, 2000, 2500, 3000 and 3500 of 5,841 total lines.
- Every other channel is similarly scattered (sms 40, polls 51, phone-bank 36,
  social 40, door 34, email 22).

Consequence: splitting the design into one file per channel is not a formatting
change, it is a rewrite, and it would mean duplicating one shared flow seven
times. Do not pursue it. Positional chunking also cannot work, because no
contiguous slice contains a whole channel.

What works instead is a SEMANTIC slice, done locally after the bytes are on
disk. Two approaches:
  a. Static slicer. Resolve `flowCfg('<channel>')`, pull the shared flow
     methods, prune the branches for other channels. Cheap, works today.
  b. Runtime capture (stronger). Render the export from `file://` and drive the
     flow with Playwright, snapshotting DOM plus computed styles per step. This
     yields the already-resolved output for one channel without writing a branch
     interpreter, AND produces the geometry needed for the parity check. Needs
     React vendored locally (the export pulls it from unpkg).

Either way the MCP size cap stops mattering: the requirement is only to get the
bytes to disk once per design revision.

WORKED EXAMPLE of what truncation costs: `flowCfg('robocall')` has step order
`purpose -> who -> when -> review -> what`. Robocall is the ONLY channel that
puts review and payment BEFORE the script step; all others end with review. An
agent reading a truncated file plausibly assumes the common order and plans the
wrong flow. This is precisely the class of miss the pipeline exists to prevent.

STALENESS WARNING, and the argument for the live route: the Aug 21 export
embeds design system 2.0. The live project is 3.0, updated 2026-09-09. Working
from an export means working against a stale design system. Read the design
system live from DesignSync; use the export only for screen composition.

## Working method per skill

Same five steps for each of the three skills:

1. Stephen drops in the real example. The agent extracts the template and the
   checklist it implies.
2. The agent hands back a concrete draft. Stephen reacts (his un-verbalized
   ideas surface against something real).
3. Dry-run the template on the pilot feature and see what it misses.
4. Refine until the gate review is a fast yes / no / modify pass and nothing
   important slips.
5. Lock v1 and write it as a skill.

## Progress checklist (REVISED 2026-09-10)

Numbering matches the pipeline table in "What we're building".

DONE this session
- [x] Design acquisition solved: page `read_file` with offset/limit on the direct
      MCP endpoint. `fetch_design.py` works; full flow retrieved.
- [x] Pixel-perfect gap measured: components 174/179, tokens 28 exact /
      23 drifted / 17 missing.
- [x] Audited the teammate's existing chain; scope is the missing front half.
- [x] Confirmed features always have a Claude Design design, so the extractor is
      always the entry point.

Phase A: foundations
- [ ] Pick the pilot feature. Must exercise schema, UI, and >=1 integration.
- [ ] Harvest the scope checklist from `gp-feature-validator` (step 6) and
      `gp-ui-tester` (step 4) rather than inventing it.
- [ ] Get a scope doc Stephen considers good, if one exists, plus a feature where
      something got missed (higher value than the good example).
- [ ] Agree with the teammate on co-owning the three EXTEND/UPGRADE items.

Item 0: token reconciliation (repo-side, parallelisable)
- [ ] Confirm the 23 drifted values against the RENDERED app, not the
      `var(--x, fallback)` fallbacks. 23 is an upper bound.
- [ ] Close the gap in `packages/styleguide`; add the 17 missing tokens.

Item 1 + 2: BUILT 2026-09-11 — `.claude/skills/create-scope/`
- [x] `scripts/fetch_design.py` — pages around the 256 KiB cap, verifies the line
      count, refuses a file with a >=256 KiB single line, and explains the 401.
      TOKEN GOTCHA: the design OAuth token expires in HOURS. Any DesignSync MCP
      call refreshes the stored credential — the skill does that first.
- [x] `scripts/digest.py` — the coverage lists: state fields, method vocabulary,
      feature groups (a design file holds several features; `--focus <prefix>`
      aims at one), declared constants, parameterisation across variants,
      production-shaped literals, placeholder detection, components, tokens, copy.
- [x] `SKILL.md` — model-first process with two hard gates (the model, then
      product approval), the scope/TDD contract, per-screen in/out scope, cell
      states, the integration register and side-effect classes, and the vendor
      POC trigger.
- [x] Smoke-tested end to end against the live design URL: 759,906 bytes /
      6,999 lines fetched, digest clean, placeholder detector returns exactly the
      callback number with zero false positives.
- [ ] NOT YET VALIDATED: no agent has run the skill end to end. The extraction
      half is tested; the reasoning half is not.
- [ ] NOT YET VALIDATED BLIND: every result so far is retrodiction — the answers
      were known before the method was written. See the open questions.

Item 1 leftovers
- [ ] Promote `fetch_design.py` out of scratch into the repo.
- [ ] Add the derived analysis: flow structure, component tree with DS
      names/props/tokens, copy, state signals, gates, `isMobile` branches.
- [ ] Emit one committed artifact per design revision (gives design diffing).
- [ ] Keep the truncation guards: check `truncated`, verify line count, refuse
      on a >=256 KiB single line.

Item 2: `/create-scope` — v0 written, see above. Remaining:
- [ ] Output format: per page/section in-scope & out-of-scope, coverage matrix
      underneath, tiered decisions on top (DEFAULT APPLIED / DECISION NEEDED /
      ASSUMPTION MADE), integration register.
- [ ] Integration register with side-effect class; no test path = blocking
      question.
- [ ] Dry-run on the pilot; refine until product review is a fast pass.
- [ ] Gate: product approval on a real scope doc.

Items 3-7 (after 1 and 2 have run on the pilot)
- [ ] 3 `/create-tdd`: accept an approved scope doc; carry the register forward.
- [ ] 4 `/clickup-epic-create`: authoritative deps + files + AC; attach UI spec;
      stamp side-effect class.
- [ ] 5 `/work-on-epic`: reuse as-is; make its agents honour the side-effect
      class during smoke tests.
- [ ] 6 `/validate-feature`: source-derived design comparison; hard stop on a
      failed design read; enforce the side-effect gate; unknown = Class C.
- [ ] 7 Ratchet: filed bugs become permanent checklist rows. Seed it with the
      `TEST_OVERRIDE` materialization lesson.

## Open questions to sort out

Blocking the next step:
- Which feature is the pilot? Must exercise schema, UI, and at least one
  integration. Everything else is ready to start.
- Is the teammate a co-owner on this? Three of the seven items EXTEND or UPGRADE
  their commands. That goes much better shared than as a rewrite landing on them.
- Where does the scope doc live? ClickUp is where the team reviews; the repo is
  where the machine-readable spine survives and versions alongside the design
  digest. Leaning: artifact in the repo, rendered copy posted to ClickUp.

Design decisions already made (do not relitigate):
- Extraction is shared infrastructure, not part of the scope skill. One digest,
  three consumers, so they cannot drift or read different design revisions.
- One skill per human gate, not one per activity.
- Gate feedback resolves INSIDE the artifact, not in chat. A downstream skill
  must be able to refuse to run while any decision is unresolved.
- Every artifact carries a machine-readable spine with prose wrapped around it.
  Evidence this matters: `work-on-epic` records that dependency frontmatter "is
  stripped before tasks are POSTed", so their structured metadata was lost in
  transit and they had to fall back to the API's dependency edges.
- One build-unit path, not separate UI and backend builders. The epic step
  attaches a UI spec to the tickets that need one.

Still open, lower priority:
- Exact coverage-matrix columns, locked during the `/create-scope` dry-run.
- Whether the high-level TDD and the DAG stay separate gates. They have
  different audiences (engineers vs Stephen), which argues for keeping both.

## Context and constraints

- Repo: the omni monorepo. Skill location TBD (see above). UI lives in
  `packages/gp-webapp` (Next.js 16, styleguide tokens, pixel-perfect matching
  required). Backend patterns (createPrismaBase, contracts-first, module shape)
  are documented in per-package AGENTS.md files and should ground the TDD.
- Human gates are kept, not thinned. The failure mode of over-automation is a
  beautiful plan that is subtly wrong, fanned out to ten agents who build the
  wrong thing quickly. The gates prevent that.

## Kickoff prompt (paste into a fresh chat)

> Read `feature-planning-pipeline.md` at the omni repo root, end to end. We are
> building the feature planning pipeline it describes. The plan was revised on
> 2026-09-10: design acquisition is SOLVED (`fetch_design.py`), and we are
> building only the FRONT half of the pipeline plus upgrading three existing
> commands, not a parallel chain. Start with item 1 (`design-digest`), then
> item 2 (`/create-scope`). Harvest the scope checklist from
> `gp-feature-validator` and `gp-ui-tester` rather than inventing one. Surface
> anything you had to assume as an explicit open question, work one item at a
> time, and keep the progress checklist in this doc updated.
