# Product knowledge — the assistants' map of the product they live in

The Campaign Manager (Win) and the Chief of Staff (Serve) are the first place
users go with a product question. This is the system that lets them answer,
and the process that keeps it true as the product changes.

**Editing the map?** Read
`packages/gp-api/src/chats/general/product-knowledge/AGENTS.md`. This file is
the why and the process; that one is the manual.

## The problem it solves

A September 2026 audit of 50 real Campaign Manager sessions found that **a
quarter of everything candidates ask is a product question**, and the prompt
had no description of the platform at all. The consequences, all measured:

- Fifteen of 50 sessions ended with "contact GoodParty.org support," naming
  **eight different contact routes** between them: two email addresses, a help
  URL, a help center, live chat, a chat widget, a chat bubble, and a contact
  form. The in-product support bot was never mentioned once.
- The assistant guessed at menu locations it could not see. One candidate who
  had just saved three lists asked where they were; the assistant guessed
  "Contacts, then a Lists tab," the candidate read the real menu back to it,
  and the lists turned out to be under Voter Data. Six turns.
- Asked for a door-knocking app, it recommended **two third-party canvassing
  apps by name** to a candidate who already had ours, then closed with "start
  with CampaignKnock's free tier."
- Whether it knew our door-knocking tool existed depended on what a web search
  returned that turn. It was relaying search results about GoodParty back to a
  logged-in GoodParty user.

The chief of staff audit found the same gap in July 2026. Same fix, one system,
two contexts.

## The system

One source of truth, two rendered contexts:

```
productMap.ts            the content: every product area, tagged win | serve
        │
productKnowledgePrompt.ts    renders per mode + the one support route
        │
        ├──▶ campaignManagerPrompt.ts        buildProductKnowledgeBlocks('win')
        └──▶ chiefOfStaffPrompt.ts           buildProductKnowledgeBlocks('serve')
```

Each assistant sees only the tabs its user actually has, plus one line that the
other product exists. Both get the same rules and the same single support
route, so the two never answer the same question differently.

All of it lives in
`packages/gp-api/src/chats/general/product-knowledge/`.

### Why in code rather than Contentful

The map is versioned with the feature it describes, reviewed in the PR that
ships that feature, unit tested, and enforceable. A Contentful entry would be
editable without a deploy, but nothing could hold it to the product: it would
drift silently, and "add context when we ship" would be a request rather than
a step. The audit asked for a maintained document; what makes it maintained is
that shipping without it fails.

## The process — three layers

The gate is the last one, and the point is that it never fires.

**1. In context, while the feature is being built.** An agent working in the
product-knowledge directory loads its `AGENTS.md`. Pointers sit in the root
`AGENTS.md`, `packages/gp-api/AGENTS.md`, the dashboard's own `AGENTS.md`, and
a comment on the nav registry itself, so the rule is visible from wherever the
work starts.

**2. At build time, the moment the nav changes.** A `PostToolUse` hook
(`.claude/hooks/product-map-check.sh`, wired in `.claude/settings.json`) runs
after any edit:

- Edited the dashboard nav registry? It runs the coverage check and, on
  failure, hands the agent the exact fix and stops it going further.
- Edited a dashboard route page? It nudges, because a feature reached from
  inside another page is real to users and invisible to the coverage check.

Pre-commit covers the human path: `lint-staged.config.js` runs the check when
either the nav registry or the map is staged.

Run it yourself any time:

```bash
npm run product-map:check
```

**3. The CI gate.** `productMapCoverage.test.ts` in gp-api. Both `gp-api.yml`
and `gp-webapp.yml` run on every pull request with no path filters, so a PR
that adds a tab without a map entry fails whichever package it touched. It
fails in both directions: an undescribed tab, and a described tab that no
longer exists.

### What the gate cannot see

It matches nav tabs. It cannot tell that a feature reached from inside another
page exists, that a description has gone stale, or that a sentence is simply
wrong. Layers 1 and 2 are what cover those, which is why the map is a
same-PR habit rather than a chore someone does when CI complains.

## The help center, and why the map still outranks it

Both assistants also have `search_help_center`
(`packages/gp-api/src/chats/general/help-center/`), which searches our own
support articles for how-to steps, compliance rules, billing, and anything
procedural the map does not carry.

It reads HubSpot's public site-search endpoint. That endpoint needs **no
credential, no scope, and no Service Hub tier** — the portal id is already
public, being the support widget's own script src — so the tool works in every
environment with no configuration. It returns titles, links, summaries, and
categories, never article bodies: enough to answer and to link the right page.

**The map wins on anything about naming or location.** A spike over all 65
public articles found real drift: one still sends candidates to a "Content
Builder" tab that does not exist, and the articles say "segments" where the
product says "lists". The map is gated against the real nav on every PR; the
articles are gated against nothing. So the prompt orders them explicitly, and
tells the assistant to trust the map and describe the current screen when an
article names something it cannot find.

Two things for whoever owns the help center: an article titled
"TEMPLATE (clone)" is publicly live and indexed, and the door-knocking article
needs rewriting against the current navigation.

## Support routing

**One route, both assistants:** the support chat, opened from **Get help** at
the bottom of the left-hand menu, with `support@goodparty.org` as the email
fallback. Both are constants (`SUPPORT_ROUTE`, `SUPPORT_EMAIL`) and nothing
else may be named.

`SUPPORT_ROUTE` names no section of that menu on purpose: Get help ends the
main nav on desktop and sits in the account group on mobile, so any wording
more specific is wrong on one of the two.

### Where the support chat lives

It is HubSpot Conversations, loaded from the root `<head>` in
`gp-webapp/app/layout.tsx` in production, and anywhere else only behind
`NEXT_PUBLIC_SUPPORT_CHAT=1` — in `.env.local` for local, or in Vercel's
Preview environment to exercise it on a PR preview. Do not reach for
`IS_PREVIEW` instead: it reads `NEXT_PUBLIC_VERCEL_TARGET_ENV`, which this app
does not reliably get, and on a real PR preview it was not `preview`, so the
script did not load at all. Both script tags belong in `<head>`: a
`beforeInteractive` script has to be there, and a `<script>` anywhere else
under `<html>` is invalid HTML that React reports as three hydration errors.

It used to render its own launcher hovering over every page; the layout now
sets `hsConversationsSettings.loadImmediately = false` to suppress that, and
`@shared/utils/supportWidget.ts` opens it from the nav. Closing the chat
unmounts it with `widget.remove()`, because HubSpot otherwise collapses back to
that launcher — a fixed button in the corner this product uses for the
assistant's message box, which is the thing moving support into the nav was
meant to get rid of. The next Get help click mounts it again.

Whether it opened is asked of the SDK (`widget.status().loaded`), never
assumed, and watched rather than checked once: a single check cannot tell
"never coming" from "still coming", and guessing wrong navigates to a mail
client over the top of a widget mid-animation. Only a widget still absent at
the deadline counts as failure, and then the click goes to email rather than
nowhere.

Two things about the SDK are worth knowing before changing that helper, both
measured rather than read off the docs:

- **`load({widgetOpen: true})` does not open the panel.** It renders the
  launcher and the greeting bubble and leaves the panel shut. `open()` is what
  opens it, so the watch calls `open()` as soon as the widget exists.
- **`status()` lags reality, in both directions.** On a cold local load it
  reported `{loaded: false, pending: false}` for around ten seconds after the
  container was already in the DOM and the iframe was fetching; on another load
  it flipped to `loaded` before the container existed. So the watch waits for
  both, and the deadline branch checks the DOM before giving up — believing
  `status()` there would send a mail client over the top of a widget the user
  can see.
- **The `on()` event API delivered nothing.** With `widgetClosed` and
  `widgetOpened` listeners registered before `load()`, opening and closing the
  panel raised neither. The close is detected from the container's inline size
  instead, which HubSpot writes itself: 92x92 collapsed, 448x804 open.

**HubSpot's chatflow targeting decides whether the widget may load at all**,
and it is host-based: website-URL rules on the chatflow, edited in the HubSpot
UI under Service > Chatflows > Edit > Target, with no API. The rules cover
production, Vercel previews (`good-party.vercel.app`) and `localhost`. A host
outside them loads the SDK and then does nothing at all — `status()` stuck at
`{loaded: false, pending: false}`, no container, even calling `load()` from the
console — which is what `localhost` did before those rules existed. If the
widget stops appearing on some new host, look there before looking here.

There is no API to invoke HubSpot's Breeze Customer Agent directly, so the
widget remains how a user reaches it. That is why this is a relocation rather
than a replacement.

The product shows two addresses, and which one depends on who works the queue.
Both live in `gp-webapp/app/shared/utils/supportContact.ts`; import one rather
than writing an address.

| Constant                       | Address                         | Used by                                                                          |
| ------------------------------ | ------------------------------- | -------------------------------------------------------------------------------- |
| `SUPPORT_EMAIL`                | `support@goodparty.org`         | General support: voter data, door knocking, re-election, the widget fallback     |
| `PRO_COMPLIANCE_SUPPORT_EMAIL` | `campaignsuccess@goodparty.org` | Pro upgrades and 10DLC texting compliance, which campaign success works directly |

There used to be a third, `help@`, in the voter-data and door-knocking error
states. That one is gone.

The assistants name only the general route. A candidate mid-compliance reaches
campaign success through the Pro and texting flows themselves, where the
product already knows that is the context; giving the assistant a second
address to choose between is how eight of them appeared in the first place.

### Answer first, hand off second

The assistants answer basic product questions themselves, from the map. A
handoff instead of an answer the map could have given is a failure; a handoff
after saying what you know is good service. Escalate for billing, refunds,
account changes, anything needing a change made on the user's behalf, and any
bug.

## Source

Campaign manager conversation audit, September 2026 (section 3, recommendation
1); chief of staff production transcript audit, July 2026 (recommendation 3).
