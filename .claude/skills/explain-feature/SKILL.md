---
name: explain-feature
description: Write the holistic understanding doc for a feature that already exists: what it is for, how it works end to end, what must stay true, what breaks if you touch it, and what is deliberate but looks wrong. Use before modifying an unfamiliar feature, when onboarding an agent onto one, or when a change keeps breaking things nobody predicted. Produces docs/how-it-works/<feature>.md.
argument-hint: <feature> [--commit <sha>]
allowed-tools: Bash Read Write Glob Grep Skill mcp__claude_ai_ClickUp__clickup_get_document_pages mcp__claude_ai_ClickUp__clickup_list_document_pages mcp__claude_ai_ClickUp__clickup_search
---

Write the understanding doc for the feature named in $ARGUMENTS.

## Who reads this and why

An agent about to change code it did not write. It has `AGENTS.md` for the shape
of the module and the code for the detail. What it does not have is **what the
feature is for**, and without that it makes locally correct changes that are
globally wrong. It raises an audio limit without knowing the number interacts with
vendor pricing and a compliance gate. It removes a duplicated check that is the
only thing stopping a security hole.

So this document answers one question: **what would someone need to understand
before they were allowed to change this?** Everything that does not serve that is
cut.

## What this is not

- **Not `AGENTS.md`.** That is reference, organised by code, read by lookup. This
  is orientation, organised by the feature, read once before starting. Do not
  restate it and do not replace it.
- **Not a TDD.** `docs/features/` holds design-time documents: what we intended to
  build. They are frozen and go stale by design. This describes what the code
  actually does now and must track it, which is why it lives elsewhere.
- **Not an inventory.** No file listings, no per-function tables, no restating what
  the code plainly says.

## Sources, in order of authority

1. **The code. It is the truth.** What it does is what the feature does.
2. **`AGENTS.md` in each directory the feature touches.** These carry invariants
   someone already paid to learn. Harvest them; do not re-derive them.
3. **The design and any TDD.** These are *intent*: what the feature was trying to
   be. Three places to look, and the first two are outside the repo:

   - **Claude Design.** Use the `claude-design-read` skill. Do not use
     `DesignSync.get_file` directly: it caps every read at 256 KiB and reports
     success while truncating, so you get roughly the first third of a real design
     with no error.
   - **ClickUp.** TDDs live under the Technical Design Docs page
     (`2ky4jq2q-81493`) in the Eng Docs doc (`2ky4jq2q-20493`), workspace
     `90132012119`. Search for the feature name, then read the page and its
     Implementation Notes child. **Read only.** Never create or update a ClickUp
     page from this skill.
   - **The repo.** `docs/features/` holds TDDs and implementation plans.

   If you cannot reach a source, say so in the derived-from stamp rather than
   quietly proceeding without it. A document that claims to reconcile code against
   intent, having never seen the intent, is worse than one that admits the gap.

**Where the code and the intent disagree, say so.** A design that shows a refund
the code never implements is either a missing feature or a stale design, and which
one it is matters to whoever reads this next. Record the disagreement; do not
quietly resolve it.

Unlike a product-facing scope doc, **identifiers belong here**. Name the function,
the column, the constant. The reader is going to open the file. Every claim should
be checkable in one grep.

---

## Step 1: find the whole feature

A feature is not a directory. It spans `gp-api`, `gp-webapp`, `contracts`, and
sometimes the styleguide and a vendor module. Start from the obvious directory,
then find the rest:

```bash
# design and TDD, if they exist: /claude-design-read for the design,
# ClickUp search for the TDD, and locally:
ls docs/features/*<feature>* docs/how-it-works/*<feature>* 2>/dev/null
# the obvious homes
ls packages/gp-api/src/<feature> packages/gp-webapp/app/dashboard/<feature> 2>/dev/null
# everything that names it
grep -ril "<feature>" packages --include=*.ts --include=*.tsx -l | grep -v node_modules | sed 's|/[^/]*$||' | sort -u
# the AGENTS.md files that cover those directories
find packages -name AGENTS.md -not -path "*/node_modules/*" | xargs grep -l -i "<feature>"
# contracts and prisma models
ls packages/contracts/src/**/*<Feature>* packages/gp-api/prisma/schema/*<feature>* 2>/dev/null
```

Grepping the feature name across the repo finds more than the directory does, and
the parts it finds elsewhere are usually where the surprises live.

## Step 2: work out what it is for, from the code

Not from anyone's brief. The code states its purpose if you read it as a product
rather than as a program:

- **User-facing copy.** The strings are the clearest statement of intent in the
  repo. What does the feature tell the user it is doing?
- **The enums.** A status set is a claim about the lifecycle. A settle-state enum
  with terminals for `voided`, `uncollectable` and `disputed` tells you money is
  real and can fail in three distinct ways.
- **What is priced, and per what unit.** That is the business model in one line.
- **The tests.** What they assert is what somebody decided must be true.
- **The `AGENTS.md` preamble**, which is usually one good paragraph.

Write it as a short paragraph explaining the feature to someone who has never seen
it. **If you cannot, stop and read more code.** A document that opens with a
restatement of the module structure is the failure mode this skill exists to
prevent.

## Step 3: trace one real action end to end

Pick the thing the feature exists to do and follow it across every package, in
order, as a single path: the click, the request, the validation, the writes, the
external call, the response, and what comes back later.

One path, named in the terms of the thing happening rather than the layers it
passes through. A reader should be able to hold it in their head. Where the path
forks for a real reason, say why; where it forks for a historical reason, say that
too.

## Step 4: what must stay true

**Start with the existing `AGENTS.md` invariants.** They are the most valuable
prose in the repo and they were written by people who got burned. Carry the ones
that are feature-level, in their own words where the wording is doing work.

Then derive the ones nobody wrote down, from the code:

- Unique constraints and what they are actually protecting against
- Guards that reject, and the state they are keeping out
- Ordering requirements: what must exist before what
- Terminal states, and whether every path reaches one
- Anything checked twice in different places, which is usually an invariant with a
  history

State each as a thing that must remain true, not as a warning. "Compliance is
bound to the audio bytes, not the key" is usable. "Be careful with compliance" is
not.

## Step 5: what breaks if you touch this

Blast radius, derived rather than guessed. For the feature's main entry points and
shared helpers, find the other callers: who else reads this table, who else calls
this service, which other features share this code path, what consumes the events
it emits.

The cases worth naming are the ones where the caller is a **different feature**.
A change that looks local is not local when six other channels run through the
same function.

## Step 6: deliberate and looks wrong

The section nothing else in the repo provides, and the one most likely to prevent
real damage.

**This repo's comment convention is a gift here.** Comments are only written for a
non-obvious *why*: a hidden constraint, a subtle invariant, a workaround. So every
comment in the feature's code is a candidate entry, already explained by the person
who put it there. Read them all.

Then look for the shapes that attract unwanted tidying:

- A check that appears redundant and is not
- A value frozen or copied rather than read live
- An explicit non-optimisation, or a slower path chosen on purpose
- A fallback that looks like dead code
- A field that is always null on one class of row and meaningful on another

For each: what it looks like, what it actually does, and what breaks if someone
simplifies it. Two sentences.

## Step 7: stamp what it was derived from

End the document with the commit it was written against and which directories were
read. A stale explanation is worse than none, because it is confidently wrong, and
without a stamp staleness is invisible.

```
Derived from <sha> on <date>.
Code read: <dirs>. Intent read: <design / TDD, or "none found">.
If the feature has changed since, this document is suspect. Verify before trusting.
```

---

## Shape and length

`docs/how-it-works/<feature>.md`, and add a pointer to it from the `AGENTS.md` of
each directory the feature touches, in their existing pointer tables.

Sections, in this order: what it is for · how it works end to end · what must stay
true · what breaks if you touch this · deliberate and looks wrong · derived-from.

**Target 1,200 words. Hard cap 2,000.** This is the whole design constraint. A
document nobody reads before starting work has failed no matter how accurate it is,
and the repo already has a 1,113-line reference doc for anyone who wants detail.
When you are over, cut the parts the code says plainly and keep the parts it does
not say at all.

## Before declaring done

- Every claim checkable in one grep.
- Purpose paragraph readable by someone who has never seen the feature.
- No section restating `AGENTS.md`.
- Every disagreement between code and design recorded rather than resolved.
- Under the cap.
- Would you want an agent to have read this before it touched your code? If not,
  say what is missing rather than shipping it.
