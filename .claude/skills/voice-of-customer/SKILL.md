---
name: voice-of-customer
description: >-
  Query GoodParty's voice-of-customer archive to answer what candidates and elected
  officials are saying. Use for customer feedback, user research, product friction,
  feature requests, pain points, testimonials, quotes, sentiment, and cross-call
  themes for Win (candidates) or Serve (elected officials / EOs). Triggers on
  "what are users/candidates/EOs saying about...", "find a testimonial/quote",
  "voice of customer", "VoC", "what do customers think of <feature>".
---

# Voice of Customer

Answer questions from GoodParty's voice-of-customer archive under `customers/`. This is summarized, human-reviewed customer data, not raw transcripts. Your job is to route the question to the right files, ground every answer in real quotes with citations, and never invent patterns.

## Step 0 — Find the archive

The archive lives in the private `thegoodparty/product-os` repo, not here. Omni is public, so customer data never comes into this repo.

1. Resolve the product-os checkout: `$PRODUCT_OS_DIR` if it is set, otherwise `../product-os` next to the Omni checkout. In a cloud session, add `thegoodparty/product-os` as a second repository.
2. If neither is a product-os checkout, stop and tell the user to run `git clone https://github.com/thegoodparty/product-os ../product-os` from the Omni root, or set `PRODUCT_OS_DIR`.
3. Run `git -C <product-os> pull --ff-only` so the answer uses the latest calls.

Every `customers/` path below is relative to that checkout. Never copy a quote, a participant name, or a call file into Omni: not into code, docs, a PR, or a commit message.

## Before you start

The two folder guides are authoritative. Read the one(s) that match the question before pulling content:

- `customers/CLAUDE.md`: how the whole `customers/` folder is organized and queried.
- `customers/marketing-research/README.md`: the marketing track in detail, including consent rules.

If the question is ambiguous about who or what, ask the user before guessing. Routing wrong wastes their time and risks conflating two different products.

## Step 1 — Pick the audience

`win/` = **candidates** (people running for office, using the Win product).
`serve/` = **elected officials / EOs** (people in office, using the Serve product). "Carla" is the representative Serve persona.

These are different products, different users, different problems. **Never blend Win and Serve insights into one answer** unless the user explicitly asks to compare them, and if you do compare, keep the two clearly labeled.

## Step 2 — Pick the track

Pick by what the question is really after:

- **Product behavior, friction, bugs, feature requests, "what's broken / missing / asked for"** → `customers/user-research/` (`win/`, `serve/`, `themes/`).
- **Voice, story, testimonials, quotable lines, copy, positioning, per-feature perception/sentiment** → `customers/marketing-research/` (`candidates/`, `eos/`, `themes/`).

The same person can appear in both tracks. If it's genuinely unclear, check both and say so.

Check `customers/CLAUDE.md` for which of the other tracks (`sales-calls/`, `candidate-success-calls/`, `user-success-calls/`) have data yet.

## Step 3 — Pick the depth

- **One named participant** → read their per-call file(s) directly. Files are `YYYY-MM-DD-participant-name.md`. A person may have several calls; read across them.
- **Patterns across many calls** → start from the **most recent** synthesis in the relevant `themes/` folder:
  - `customers/user-research/themes/YYYY-MM-DD-weekly-synthesis.md`
  - `customers/marketing-research/themes/YYYY-MM-DD-synthesis.md`
- **Everything about one feature** (polling, texting, dashboard, voter file, meeting briefings, etc.) → use the feature index in the latest marketing synthesis, or grep `[feature: <name>]` across `marketing-research/candidates/` and `marketing-research/eos/`. Then read the surrounding section for context.
- **A specific problem area** with no obvious participant → grep across `user-research/win/` and `user-research/serve/`.

## The rules that matter

1. **Do not synthesize across calls yourself.** Cross-call themes have already been produced by a human-reviewed process and live in the `themes/` folders. If the user wants patterns, pull from those files. Generating your own themes from raw per-call files risks recombining quotes out of context. Don't.

2. **Always cite.** Every quote you surface carries its participant, file, and (where present) timestamp, e.g. *<Participant name>, YYYY-MM-DD-participant-name.md [mm:ss]*. Quote verbatim; don't paraphrase a quote into quotation marks.

3. **Keep quotes in context.** Don't lift an isolated line. Read the surrounding section so you represent what the person actually meant.

4. **Treat the "Analyst note" as the only interpretation layer.** In per-call files, everything except the analyst note is raw signal. Attribute analyst judgment as such; don't present it as the customer's own words.

5. **Consent gates external use (marketing track).** Quotes are tagged for external use. Only `[External OK]` is cleared for publication. Treat `[Internal only]` and `[External - needs consent]` as **not** cleared and flag them as needing sign-off. If a teammate wants quotes for anything public-facing (web copy, social, decks for outside audiences), filter to `[External OK]` only. The full rules are in `marketing-research/README.md`. `user-research/` content is internal and not consent-cleared for publication.

6. **This is summarized data, handle it as internal.** Do not reproduce or speculate beyond what the files contain. Don't combine it with restricted voter/L2 data. Omni is public, so a customer quote never lands in it.

## Answer format

Lead with the direct answer to the question. Support it with cited verbatim quotes grouped sensibly (by theme, by participant, or by Win vs Serve). When you draw on a synthesis file, name it and its date so the user knows the patterns are human-reviewed, not your own. Close by pointing to the files you used so they can read deeper. Keep it plain and direct.
