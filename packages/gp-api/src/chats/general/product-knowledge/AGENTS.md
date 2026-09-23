# Product knowledge — what the assistants know about the product they live in

The Campaign Manager (Win) and the Chief of Staff (Serve) are the first place
users go with a product question. A quarter of everything candidates ask the
Campaign Manager is one. This directory is the answer both assistants read.

**If you are adding or changing a user-facing feature, you are in the right
place: add it to `productMap.ts` in the same PR.** That is the whole process.
CI fails without it, but the point is to get it right while you still have the
feature in your head.

## Files

| File                         | Role                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `productMap.ts`              | **The content.** Every area of the product, per mode. This is what you edit. |
| `productKnowledgePrompt.ts`  | Renders the map into prompt blocks, plus the one support route. Rarely edit. |
| `productMapCoverage.ts`      | The check: every nav tab has an entry, every entry is still a tab.           |
| `productMapCoverage.test.ts` | Where CI fails when the map goes stale.                                      |

Rendered into `../campaign-manager/campaignManagerPrompt.ts` (`'win'`) and
`../chief-of-staff/services/chiefOfStaffPrompt.ts` (`'serve'`).

The map has a companion: `../help-center/` holds `search_help_center`, which
searches our published support articles. The two split cleanly.

| Question                                    | Source               |
| ------------------------------------------- | -------------------- |
| Where does X live? What is this tab called? | the map, always      |
| How do I do X? What are the texting rules?  | `search_help_center` |

**The map outranks the articles on naming and location, and that ordering is
load-bearing.** The articles are hand-written and some are behind the product:
one still sends candidates to a "Content Builder" tab that does not exist, and
they say "segments" where the product says "lists". The map is gated against
the real nav; the articles are not gated against anything.

## Adding a feature to the map

A `ProductArea` is four decisions:

- **`name`** — exactly what the left rail spells, character for character. The
  assistant tells a user to click this string. Pull it from
  `gp-webapp/app/dashboard/shared/navLabels.ts` where one exists.
- **`modes`** — `['win']`, `['serve']`, or both. A Win assistant must never
  describe a Serve tab: the user cannot see it and does not have it.
- **`does`** — one sentence, in the user's words, on what they do there. Not
  what it is built out of.
- **`inside`** — only the things people actually hunt for. "Where are my saved
  lists" took one audited session six turns and ended with the candidate
  reading their own menu back to the assistant. That is what this field is for.

Add `gate` when access is not simply open (Pro, a payment, a prerequisite),
and `aliasOf` when a second nav entry points at an area already described.

## What does NOT belong here

- **Anything an assistant cannot do anything with.** Service names, flags,
  table names, our architecture.
- **Detail that rots faster than the map gets read.** If a line is wrong the
  day someone moves a button, it was too specific.
- **Anything unverified.** Every line here is stated to users as fact. If you
  are not sure a linkage is real, read the code or leave it out. The map's
  value is that the assistant stops guessing, and a wrong entry is worse than
  a missing one: it guesses with our authority behind it.

## Rules that are not the map's content

`productKnowledgePrompt.ts` holds the behavior, and it should change far less
often than the map:

- Answer from the map; never guess a tab, button, or URL not in it.
- Never use web search for a question about GoodParty.org. Search results
  about our own product are marketing pages, and the user is already logged
  in. The manager was relaying them back to candidates.
- Never name a third-party tool for something we build. The audit found two
  third-party canvassing apps recommended to a candidate who already had our
  door-knocking tool.
- **One support route**, `SUPPORT_ROUTE` + `SUPPORT_EMAIL`, plus
  `HELP_CENTER_URL` for what Get help falls back to when the chat cannot load.
  Before this, fifteen of fifty audited sessions ended in a handoff and named
  eight different routes between them. Everything a user gets sent to comes
  from those constants, and all three are duplicated in gp-webapp
  (`app/shared/utils/supportContact.ts`) — change both sides together.
- **Name an unmet gate when describing what it locks.** The map's `Access`
  notes say what each area needs; the account's Pro status reaches the map
  as one data line when the caller passes it (it is an argument of
  `buildProductKnowledgeBlocks`; the Chief of Staff passes `null`, so its map
  says nothing about Pro). The rule reads both and names Pro but no
  feature, so a new Pro-gated area added to the map is covered without a
  prompt edit.

## Why the assistants answer support questions at all

Because users ask them, and the alternative is a dead end. The rule is answer
first, hand off second: a handoff instead of an answer the map could have
given is a failure, and a handoff after saying what you know is good service.

## Source

Campaign manager conversation audit, September 2026, section 3 and
recommendation 1; the chief of staff audit found the same gap in July 2026.
Process and rationale: `docs/product-knowledge.md`.
