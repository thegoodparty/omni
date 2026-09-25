---
name: create-scope
description: Turn a feature's holistic understanding and its design into a scope doc product can approve: the per-screen in-scope / out-of-scope list, with every product decision surfaced up front so it does not surface mid-build. Reads docs/how-it-works/<feature>.md when it exists and runs explain-feature to create one when it does not. Use when starting a feature from a design, scoping a design, or preparing the product gate before a TDD. Runs before create-tdd and produces its input.
argument-hint: <feature> [--design <url>] [--clickup <page-id>] [--transcript <path>]
allowed-tools: Bash Read Write Glob Grep Skill mcp__claude_ai_ClickUp__clickup_get_document_pages mcp__claude_ai_ClickUp__clickup_list_document_pages mcp__claude_ai_ClickUp__clickup_search
---

Produce the scope doc for the design at $ARGUMENTS.

The goal is a shared understanding of the ask, agreed before anyone builds. You
are the first pass; a human decides. Your value is finding the real questions and
stating them plainly, not answering them.

## The contract with the TDD

**Scope owns the ask. The TDD owns the how.** Every product decision is resolved
here. A product decision that surfaces during the TDD means this document was
incomplete.

The test for whether a line belongs in this document: **can product answer it?**
Data model, failure blast radius, input validation, migrations — real questions,
but `create-tdd` owns them. Flag them for hand-off; do not ask product to decide
them.

## Hard rules

- **Never invent.** No requirement, label, state, or behaviour that is not in the
  design, the repo, or the user's words. If something is missing or ambiguous:
  say so as an open question. Filling a gap with your own idea is the failure
  this skill exists to prevent.
- **Silence is not an answer.** "N/A because &lt;reason&gt;" is valid. A blank is not.
- **Mark every guess.** Anything you assumed is an ASSUMPTION, surfaced, never
  quietly folded into a bullet.
- **Stop at the gates.** Two of them, below. Do not run past either.

---

## Step 1: get the understanding

**The scope doc is built on top of a holistic understanding of the feature, never
instead of one.** That understanding is `explain-feature`'s job, not this skill's.

**If `docs/how-it-works/<feature>.md` exists, read it.** That is the upgraded path
and the one to prefer. It gives you what the feature is for, how it must work end to
end, what must stay true, and where the chain could not be completed. Check its
derived-from stamp: if it describes a design older than the one you were given, say
so and re-run `explain-feature` rather than scoping against a stale reading.

**If it does not exist, produce it.** Run the `explain-feature` skill for this
feature and let it finish before you write a single scope bullet. It will fetch the
design through `claude-design-read`, run the digest, and write the artifact. Do not
re-derive any of that here; there should be exactly one implementation of the
reasoning and it is not this one.

Either way you arrive at Step 2 holding an understanding artifact with a set of
places the chain breaks. **Those break points are what become decisions.**

Never fetch a design yourself, and never call `DesignSync.get_file`: it caps reads at
256 KiB and reports success while truncating. `claude-design-read` exists for this
and is maintained on main.

## Step 2: turn break points into items

Every break point in the understanding becomes at least one item in the scope doc, or
an explicit note saying why it did not. Every item cites the break point behind it.
That link is what keeps the reasoning load-bearing instead of ornamental. An item
with no break point behind it was found by inventory rather than by reasoning, which
is allowed, but say so, and consider whether `explain-feature` should have caught it.

Take the understanding's own judgement on whether the design accomplishes what it is
for, and carry it into the scope doc. It is usually the most important thing in
either document, and it is not a defect, so nothing else will surface it.

## Step 3: reconcile with the kick-off call (if there is a transcript)

A design is handed over in a call where product fills in blanks out loud. If you were
given a transcript, read it **now**: after the understanding exists, never before.

**Why after.** Read first and you inherit product's framing and stop deriving
anything; the understanding's whole value is that it worked out the purpose from the
design on its own. Read after, and **the places where the two disagree become
findings**. That is the "we all thought we agreed" failure, and it is invisible if
you read them together.

Take each break point from the understanding, and each open question, to the transcript. Four outcomes:

| Outcome | What to do |
|---|---|
| **Answered** | Quote the line. Mark it **answered verbally, confirm** — never just closed. A thing said in a call is not a decision, people misspeak, and in six weeks nobody remembers whether it was settled or floated. |
| **Contradicted** | The design implies one thing, the call said another. **This is a new item and usually an important one.** Give it its own line with both sides quoted. |
| **Raised, not resolved** | Discussed and left hanging. Still open. Say it was discussed, so product knows you heard them and the question survived anyway. |
| **Not mentioned** | Open, unchanged. |

Also mine the transcript for **constraints and intent the design cannot carry**:
a deadline, a budget, a vendor already chosen, a thing explicitly out of scope for
this release, a reason behind a screen. Those become context in the model, quoted.

**Everything from the transcript is marked as such**, in the model and in the
scope doc. A reader must always be able to tell what came from the design, what
came from the call, and what you inferred. Do not let a verbal aside end up
looking like a design fact.

**Silence is not agreement.** A topic raised and dropped is still open.

> ### ⛔ GATE 1: the understanding
> Present the understanding and its break points. **Stop.** If nobody is available
> to answer (an unattended run), do not block: note in the understanding doc that
> GATE 1 would fire here, and carry on. **The understanding must still exist and be
> complete before you create the scope doc.** An unattended run skips the human, not
> the step. A wrong model makes every
> bullet beneath it wrong, and a human can tell in a minute. Also list what you
> assumed to write it — correcting an assumption changes the model's shape.
> Do not write scope bullets until the model is confirmed.

## Step 4: write the scope doc

Follow the flow in order. Everything about a screen lives with that screen, so it
can be read with the design open alongside. Only genuinely feature-wide items are
pulled out, at the end.

### Per screen

Head each with the step number and the design's own title, then, in this order:

**A description first.** One or two plain sentences: what this screen is, what the
user does here, and what it leads to. A run produced screens whose entire
description was the single word "New." followed by a table, which tells a reader
nothing. The surface-status label is not a description — it is a label.

**Surface status** — reused as-is, modified, or new. One word plus, if modified,
what specifically changed.

**In scope** — bullets, what we commit to build.
**Out of scope** — bullets, what we commit *not* to build. This is a proposal
product must agree to, not a description; it is the half that stops someone
assuming it works later. Say so.
**Then** the decisions and assumptions for that screen, inline.

First answer the screen's **surface status**, which decides how much to fill in:
*reused as-is* collapses everything (name the component and move on), *modified*
fills only what the change touches, *new* fills the lot.

Then, for each of: data source per element · empty · loading · error and
recovery · permissions and entitlement · disabled conditions and validation ·
responsive · copy final or placeholder — mark one of:

| | |
|---|---|
| **SPECIFIED** | The design answers it. Record the answer and where. Not a question. |
| **DEFAULT** | Design silent, standard pattern applies. Collapsed. |
| **DECISION** | Genuinely product's call. Surfaced. |
| **ASSUMPTION** | Design silent, no standard, you guessed. Surfaced. |
| **N/A** | With the reason. |
| **ANSWERED VERBALLY** | Settled in the kick-off call. Quote the line and who said it. Still needs a written yes at the gate. |


**DEFECT is not a cell mark.** A real defect is cross-cell and usually
cross-screen: the design contradicts itself, or specifies something that cannot
work. It is a document-level finding with its own index line, stating what is
broken and attaching the product question it forces. Do not try to file it in a
cell.

Most cells resolve to SPECIFIED or DEFAULT and collapse. Two rarely do: **out of
scope**, because a design cannot state an absence, and **data source**, because
designs never say where data comes from. "The API" is not an answer.

### Keep the review short: three rules, in this order

A blind run of this skill produced **31 decisions and 10 assumptions**. The same
feature, reviewed well, is **about a dozen**. Length is not the problem, count is,
and the count comes from three habits. Apply these before writing the index.

**1. Merge anything one person answers in one sentence.**
If two questions go to the same person and get settled in the same breath, they
are one decision with sub-bullets, not two. From the blind run:

| Ran as | Should be |
|---|---|
| Four separate questions about which quantity is billed, which subset is eligible, whether a ceiling exists, and why two screens quote different totals | **One decision: what do we charge for.** The rest are its evidence and its sub-parts |
| Separate questions about when money is taken, which stored method is used, and what a unit price actually buys | **One decision: the payment model** |
| Separate questions about a minimum lead time, whose timezone applies, whether a timestamp is a start or a deadline, and a dead option in the picker | **One decision: when does it send** |

**2. Decide it yourself unless it earns escalation.** The default posture is
decide-and-record, not ask. A question earns product's time only if getting it
wrong would **cost money, break a legal obligation, force rework, or change what
we build**. Everything else is a DEFAULT (standard pattern, collapsed) or an
ASSUMPTION (you picked, you noted it, one line). "Does the channel card signal
Pro?", "Where do you land after the upgrade?", "Is the receipt emailed?" are all
defaults. Escalating them buries the four that matter.

**3. Collapse reused surfaces, hard.** A screen whose surface status is *reused
as-is* gets **three lines: what it is, that it is unchanged, and what we add.** No
cell grid, no decisions. *Modified* gets only the rows the change touches. The
blind run wrote full sections for the channel picker, the Pro gate and the detail
drawer, all pre-existing, and that alone is a third of its length.

**Then rank by cost, and put a line under it.** Order decisions by what going
wrong costs, most expensive first. Below the top group, a short "also noted"
list for the rest. Ranked, a long tail is harmless, because the reviewer reads
down until it stops mattering and the completeness is still on the page.

### Four carve-outs the rules do not override

Tested: applying the three rules literally suppressed four real problems. These
beat the rules every time.

**Rank assumptions by cost too, and put a severe one at the top.** Rule 2 says a
guess becomes "an ASSUMPTION, one line". That is right for "is the receipt
emailed" and catastrophically wrong for a guess whose failure mode is expensive.
A measured run found a permission-denied path whose fallback **fabricates a
valid-looking but empty artifact that satisfies every downstream check**, after
the user has paid. Applied literally, the rule filed the most dangerous path in
the feature as a one-line checkbox below everything else. **An assumption whose failure would cost money, break the law, or
ship something harmful belongs in the index, at the top, formatted like a
decision.**

**A defect gets its own index line even when it is merged for discussion.** Rule 1
merges by *who answers*. A reviewer reads by *what is on the page*. Those come
apart for defects: "authorize, capture on send" settles the payment question in
one sentence without the answerer ever learning that a shared edit path re-enters
an already-paid flow and charges a second time. Merge the discussion; keep the
line.

**Never collapse a defect that a reused surface introduces.** Rule 3 collapses
reused-as-is screens to three lines. But a genuinely unchanged picker can still
quote one quantity to the user and hand a different one to the step that charges
for it. The surface is reused; the defect is what the new feature does with it.
Collapse the surface, keep the defect.

**Anything that changes the shape of what we build keeps its own index line —
question or not.** This is about FINDINGS, not just questions. Rule 2's test
("can product answer it?") correctly routes engineering questions to the TDD, but
it also routes out *gaps*, and a gap can be the biggest thing in the document. A
run found that the artifact the whole feature exists to deliver is never
persisted or transmitted anywhere, so **as specified the feature cannot do the one
thing it is for** — and because that is a gap rather than a question, it ended up
as one bullet deep in the document with no index line at all. The same happened to
"no third-party provider is named anywhere", which gated five other decisions. If a reviewer would say "wait, then none of this works", it goes in the
index, phrased as the finding, with the product question attached underneath.

Merge pressure can likewise dissolve a question like "does this variant need the
regulatory gate its siblings have?" across three neighbouring decisions. If the
answer would add a screen sequence, it keeps its own line.

**When a merged discussion lives on a different screen, cross-reference both ways.**
Whoever answers the payment decision will not scroll to the detail drawer to find
that Edit re-charges a paid campaign. Put a pointer at both ends.

**Two structural notes.** A decision carrying more than about four sub-bullets has
been over-merged; split it. And check the index against the body before you finish
— ranked-and-tail structure invites writing the index first, and blocks in the
tail get forgotten.

**Expect 8 to 15 DECISIONS above the ranked line.** More than 20 means you are
escalating things you should be deciding. Fewer than 5 on a feature that touches
money or a vendor means you are not looking.

**Defects and promoted assumptions are counted separately and are exempt from
that budget.** They are findings, not escalations: a design with eight
self-contradictions has eight defects and suppressing three of them to hit a
number is the exact failure this section is trying to avoid. A run landed at 18
total — 10 decisions, 6 defects, 2 assumptions — and that is a correct result,
not an overrun.

### Whole feature

- **Unstated requirements** the design implies but never says
- **Integration register** — one row per integration, including ones that do not
  exist yet: new or reuse · sandbox · test path · irreversible side effects ·
  blast radius · credential owner. A row with no test path is a blocking
  question.
- **Side-effect class** per integration, carried onto every downstream artifact.
  **A: sandboxed** — test freely. **B: override-gated** — an agent must assert the
  override is live and prove what it covers before exercising, using approved
  test targets only. **C: no safe path** — drive to the boundary, never fire the
  terminal action. **Unknown defaults to C.** An override that covers the visible
  action but not its side effects is the common trap.
- **Vendor capability** — for each third party, what does this feature depend on
  them *providing*, and is it verified against the real API? Docs are not
  verification. **Any third-party vendor triggers a POC that gates the TDD**, and
  it must exercise the endpoints you need *last* first: results, export,
  reconciliation, settlement. Failures cluster at the end of the lifecycle
  because that is what gets built last.
- **Money** — the whole failure ladder, not "do we charge": declined at purchase ·
  authorization expired before collection · delivered but uncollectable · actual
  exceeded the estimate. Who absorbs, how many retries, what the user sees, when
  we stop.
- **Reachability** — who is eligible to receive this, and is the rule legal or
  technical?
- **Provisioned resources** — does this rent, reserve, or allocate anything
  external? Who pays, per what, and what happens to it afterwards?
- **Releasing reservations** — if the thing never happens, what frees what we
  reserved, and how fast? Money held is user-visible harm.
- **What locks after commitment**, and is the lock enforced or only in the UI?
- **How does a long-running thing end?** A start state with no terminal state is
  a bug you ship.
- **In-flight work at ship** · **shared surfaces this changes for other features**
- **Multiple writers** — will this data have more than one source, and do they
  mean the same thing?
- **Shipping ahead of data** — does a report or filter go out before the data
  behind it exists, and what does it show if so?
- **What are we measuring?**

### Hand-off to the TDD, not asked of product

Data model · inputs and outputs and which are user-controlled · failure and blast
radius · migration and backfill · keyboard and focus. Flag; do not resolve.

### Output format and where it lives

Write markdown, not HTML. The doc lives in ClickUp, so use only what ClickUp
renders: headings, bold, lists, checkboxes, simple tables, blockquotes, inline
code, and `---` rules. No colour, no anchors, no emoji.

Keep the working copy at `scratch/<feature>/scope.md` and mirror it to ClickUp
through the **ClickUp MCP server**, never the REST API. ClickUp is **read-only by
default**: ask before creating or updating any page, and read the remote page
first so you surface human edits instead of clobbering them. Same discipline as
`create-tdd`.

### Write it for product, keep the proof for engineers

**The reader is a product person who has never seen the code.** Identifiers,
function names and field names mean nothing to them, and a paragraph of them gets
skipped, which means the finding gets skipped. A measured run put **90 code
references in product-facing prose** across 10 of its 18 blocks. One block had 20.

The rule: **Question and Why it matters describe what a person sees and what
happens to them. Every identifier lives in How we know, and nowhere else.**

Before, unreadable to the audience it is for:

> `SEAT_HOLD` is `{ ttl: 900 }`. The summary renders `holdMinutes` from
> `SEAT_HOLD.ttl / 60`, but `checkoutExpiry` reads `CART_TTL`, which is `1800`.

After, same fact, same precision:

> The booking page promises the seat is held for 15 minutes. Checkout actually
> releases it after 30. Someone who takes 20 minutes is told they are out of time
> while the seat is still theirs.

Then the proof, clearly marked as the engineer's audit trail:

> **How we know.** `SEAT_HOLD.ttl` is 900 · `checkoutExpiry` reads `CART_TTL`,
> which is 1800 · the summary renders `holdMinutes` from the first.

**The test:** could someone who has never opened the design tell what breaks, who
it happens to, and what it costs? If not, rewrite it. Numbers, screen names and
the words on screen are all fair game. Names from the code are not.

**Decisions resolve inside the document.** Each gets a checkbox in the summary
list at the top and a block further down with four parts:

```
### D1: billing basis

**Use these prefixes, so two runs of this skill are comparable:** `F` for a
finding (a gap that changes what we build), `DF` for a defect (the design
contradicts itself), `D` for a decision, `A` for an assumption. State the type as
a word in the block too, not just in the index — markdown has no colour and
ClickUp renders no styling.

**Question.** One sentence, in the user's terms.
**Why it matters.** Two sentences. What breaks, and what it costs. Do not restate
the question at greater length — that is where the padding comes from.
**How we know.** Citations, not prose. Semicolon-separated fragments an engineer
can grep. All the identifiers go here.
**Decision:**

**Budget: about 80 words per block, 120 hard cap.** A measured run averaged 180
and ran to 34 minutes, which nobody reads. The same findings fit in 80 words each;
what does not fit is the second paragraph explaining the first. Cutting length is
safe — cutting items is not, so **never drop a finding to hit the budget**.

**The whole document should read in about 12 minutes.** For a feature this size
that is roughly 3,000 words: a 300-word index, ~20 blocks at 80, and the rest
screens and feature-wide. If you are over, the fix is shorter blocks, not fewer.
```

The blank **Decision:** line is where product writes the answer. Tell them
plainly not to answer in comments: `create-tdd` reads this file and refuses to
start while any line is blank.

### Before you finish, check every screen has its parts

A measured run put in and out of scope on 5 of its 13 screens and the coverage
check on 2, while writing 25 callouts. The callouts are the questions; **the scope
lists are the agreement product actually signs off**, and they are the thing this
document exists to produce. Do not let the interesting half crowd out the
load-bearing half.

Every screen that is not *reused as-is* carries: a description, a surface status,
in scope, out of scope, and the coverage check. A screen missing any of them is
incomplete, the same way a blank cell is.

### Every item traces to the model

**Each item cites the break point it came from, and every break point produces at
least one item or an explicit note saying why it did not.** This is what keeps the
model load-bearing instead of ornamental. If an item has no break point behind it,
you found it by inventory rather than by reasoning — which is fine, but say so, and
check whether the model should have caught it.

### Shape of the finished doc

**The scope doc opens with a short summary of the purpose**, before the index —
a few sentences distilled from the model, not a copy of it, with a pointer to
`docs/how-it-works/<feature>.md` for the full reasoning. Label it as your reading of what the feature is
for and ask the reader to correct it if it is wrong.

It goes first because it is the cheapest thing in the document to check and the
most expensive to get wrong. A reader who disagrees with that paragraph can stop
there: every item below it was derived from it, so a wrong purpose makes the whole
document wrong, and thirty seconds at the top saves reading forty items that were
never going to be right. Most readers will not see the model, so if the purpose
only lives there, nobody checks it.

Then an index: counts, and one line per item naming its screen. The body
walks the flow. Feature-wide at the end. A reviewer reads the index, then the
screens with something in them.

**Items live inside the screen they belong to.** Not in a flat list after the
screens — a run did exactly that and every finding piled up at the end, which
defeats reading the doc with the design open. And name each screen the same way in
the index and in the body; one run called the same screen "Record your message" in
its index and "What do you want to say?" in its heading.

> ### ⛔ GATE 2: product approval
> Every DECISION and ASSUMPTION needs a yes / no / modify. Resolve them **in the
> document**, not in chat — `create-tdd` reads this file and must refuse to run
> while any are open. Do not hand off until they are closed.

## When the design changes

Re-run. The fetched file is a versioned artifact: diff two of them to see what
moved, and re-scope only the affected screens.

## Re-running after a spike

Some product decisions cannot be made until a technical constraint is known —
"bill the estimate or bill actuals?" is unanswerable until you know whether the
vendor can report actuals. When a POC comes back, **re-run the value-provenance
and completeness passes**: newly known constraints reveal required values that
were invisible before. Scope is a loop, not a single pass.
