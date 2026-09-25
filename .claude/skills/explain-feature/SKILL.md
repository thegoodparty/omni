---
name: explain-feature
description: Build the holistic understanding of a feature from whatever exists — shipped code, a Claude Design design, a ClickUp TDD, or any combination. Produces docs/how-it-works/<feature>.md: what it is for, how it works end to end, what must stay true, what breaks if you touch it, and what is deliberate but looks wrong. Use before modifying an unfamiliar feature, before scoping a new one, or when onboarding an agent onto either.
argument-hint: <feature> [--design <url>] [--clickup <page-id>] [--code <dir>]
allowed-tools: Bash Read Write Glob Grep Skill mcp__claude_ai_ClickUp__clickup_get_document_pages mcp__claude_ai_ClickUp__clickup_list_document_pages mcp__claude_ai_ClickUp__clickup_search
---

Build the understanding doc for the feature named in $ARGUMENTS.

## Who reads this and why

An agent about to work on something it did not build. For a shipped feature it has
`AGENTS.md` and the code. For a new one it has a design. In both cases what it does
not have is **what the feature is for**, and without that it makes locally correct
decisions that are globally wrong. It raises an audio limit without knowing the
number interacts with vendor pricing and a compliance gate. It removes a duplicated
check that is the only thing closing a security hole. It scopes a screen without
noticing the feature cannot do the one thing it exists to do.

This document answers one question: **what would someone need to understand before
they were allowed to work on this?** Everything that does not serve that is cut.

`create-scope` reads this artifact when one exists, instead of deriving its own.
Write it so that holds up.

## What this is not

- **Not `AGENTS.md`.** That is reference, organised by code, read by lookup. This is
  orientation, organised by the feature, read once before starting.
- **Not a TDD.** `docs/features/` holds design-time intent, frozen and stale by
  design. This tracks whatever it describes, and says which that is.
- **Not an inventory.** No file listings, no per-function tables, no restating what
  the source plainly says.

---

## Step 1: gather whatever exists

A feature can be shipped, designed, written up, or some mix. Take every source you
can reach, and note the ones you cannot.

**Code**, when the feature is built. It spans packages, so find all of it:

```bash
ls packages/gp-api/src/<feature> packages/gp-webapp/app/dashboard/<feature> 2>/dev/null
grep -ril "<feature>" packages --include=*.ts --include=*.tsx | grep -v node_modules \
  | sed 's|/[^/]*$||' | sort -u
find packages -name AGENTS.md -not -path "*/node_modules/*" | xargs grep -li "<feature>"
ls packages/contracts/src/**/*<Feature>* packages/gp-api/prisma/schema/*<feature>* 2>/dev/null
```

Grepping the name finds more than the directory does, and what it finds elsewhere is
usually where the surprises live.

**A Claude Design design.** Use the **`claude-design-read`** skill. Never call
`DesignSync.get_file` directly: it caps every read at 256 KiB and reports success
while truncating, so a real design comes back as roughly its first third with no
error. Once you have the file, run the digest for the bounded lists your reasoning
gets checked against:

```bash
python3 .claude/skills/explain-feature/scripts/digest.py <design.dc.html>
python3 .claude/skills/explain-feature/scripts/digest.py <design.dc.html> --focus <prefix>[,<prefix>]
```

A design file usually holds several features. Read the feature groups, aim at the one
you were asked about, and expect the focused digest to miss whole screens: list the
screens a user passes through and go find the ones the prefixes missed.

**A ClickUp TDD.** Under the Technical Design Docs page (`2ky4jq2q-81493`) in the Eng
Docs doc (`2ky4jq2q-20493`), workspace `90132012119`. Search the feature name, read
the page and its Implementation Notes child. **Read only.** Never create or update a
ClickUp page from this skill. Also check `docs/features/` in the repo.

## Step 2: say what this document describes

Do this before writing anything else, and put the answer at the top of the output.

| Sources | What the doc describes | How to write it |
|---|---|---|
| Code exists | **What is built.** The code is the truth: what it does is what the feature does | Present tense. Design and TDD become intent, used to cross-check |
| No code, design or TDD only | **What is proposed.** None of it is real yet | Say so plainly and keep the tense honest |
| Both, partially built | **A mix.** Name the seam | Be explicit about which parts are shipped and which are drawn |

Conflating these is the one failure that makes this document dangerous rather than
merely wrong. A reader who thinks they are learning how something works, when they
are reading how someone hoped it would work, will act on it.

**Where sources disagree, record the disagreement; do not resolve it.** A design
showing a refund the code never implements is either a missing feature or a stale
design, and which one it is matters to whoever reads this next.

## Step 3: work out what it is for

Not from anyone's brief. Read the source as a product rather than as a program.

**From code:** the user-facing strings, which are the clearest statement of intent in
the repo; the enums, because a status set is a claim about a lifecycle; what is priced
and per what unit, which is the business model in one line; what the tests assert,
because somebody decided that must be true; the `AGENTS.md` preamble.

**From a design:** the copy; the options a user picks from; the rationale text on any
recommendation; the price and its unit; the vocabulary the results screen uses; empty
states; any legal or explanatory note. Quote the evidence.

Write a short paragraph explaining the feature to someone who has never seen it.
**If you cannot, stop and read more.** A document that opens by restating the module
structure, or by listing screens, is the failure this skill exists to prevent.

## Step 4: how it works end to end

Pick the thing the feature exists to do and follow it the whole way: the click, the
request, the validation, the writes, the external call, the response, and what comes
back later. One path, named in terms of what is happening rather than the layers it
passes through, short enough to hold in your head.

**If it is not built**, this is how it *must* work, and the interesting part is where
that chain cannot be completed from the design alone. Those gaps are the most valuable
thing this document produces, and `create-scope` turns them into decisions.

Where the path forks for a real reason, say why. Where it forks for a historical
reason, say that too.

## Step 5: what must stay true

**Start with the invariants already written in `AGENTS.md`.** They are the most
valuable prose in the repo and were written by people who got burned. Carry the
feature-level ones, in their own words where the wording is doing work.

Then derive what nobody wrote down: unique constraints and what they actually protect
against; guards that reject, and the state they keep out; ordering requirements, what
must exist before what; terminal states, and whether every path reaches one; anything
checked twice in different places, which is usually an invariant with a history.

State each as a thing that must remain true, not as a warning. "Compliance is bound to
the audio bytes, not the key" is usable. "Be careful with compliance" is not.

For an unbuilt feature these are the invariants the build will have to honour, and
saying so now is cheaper than discovering them later.

## Step 6: what breaks if you touch this

Blast radius, derived rather than guessed. For the main entry points and shared
helpers, find the other callers: who else reads this table, who else calls this
service, which other features share this code path, what consumes the events it emits.

The cases worth naming are where the caller is a **different feature**. A change that
looks local is not local when six other channels run through the same function.

Unbuilt, this becomes what the feature will share, and therefore constrain.

## Step 7: deliberate and looks wrong

The section nothing else provides, and the one most likely to prevent real damage.

**The repo's comment convention is a gift here.** Comments are only written for a
non-obvious *why*: a hidden constraint, a subtle invariant, a workaround. Every comment
in the feature's code is a candidate entry, already explained by whoever wrote it. Read
them all. For a design, the equivalent is the rationale in the TDD and any decision
recorded against it.

Then look for the shapes that attract unwanted tidying: a check that appears redundant
and is not; a value frozen or copied rather than read live; an explicit
non-optimisation; a fallback that looks like dead code; a field that is always null on
one class of row and meaningful on another.

For each: what it looks like, what it actually does, and what breaks if someone
simplifies it. Two sentences.

## Step 8: stamp what it was derived from

```
Describes: what is built | what is proposed | partially built (name the seam)
Code read:   <dirs, and commit sha>                    or: none, not built
Design read: <file, via claude-design-read>            or: none found
TDD read:    <ClickUp page id or docs/features path>   or: none found
Written <date>. If the sources have changed since, this document is suspect.
```

A source you could not reach is recorded as not reached. A document that claims to
reconcile against intent, having never seen the intent, is worse than one that admits
the gap.

---

## Shape and length

`docs/how-it-works/<feature>.md`, with a pointer added to the `AGENTS.md` of each
directory the feature touches, in their existing pointer tables.

Order: what it describes · what it is for · how it works end to end · what must stay
true · what breaks if you touch it · deliberate and looks wrong · derived-from.

**Target 1,200 words. Hard cap 2,000.** This is the design constraint, not a
preference. A document nobody reads before starting work has failed no matter how
accurate it is, and `src/outreach/AGENTS.md` is already 1,113 lines for anyone who
wants detail. When over, cut what the source says plainly and keep what it does not
say at all.

Identifiers belong here, unlike a product-facing scope doc. Name the function, the
column, the constant. Every claim should be checkable in one grep or one quoted line.

## Before declaring done

- The top of the document says whether this is built, proposed, or a mix.
- The purpose paragraph is readable by someone who has never seen the feature.
- Every claim is checkable in one grep or one quoted line.
- No section restates `AGENTS.md`.
- Disagreements between sources are recorded, not resolved.
- Under the cap.
- Would you want an agent to have read this before it touched your code, or scoped
  your feature? If not, say what is missing rather than shipping it.
