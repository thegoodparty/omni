---
name: prototype
description: Enter prototype mode to build, extend, or explore a UI prototype in packages/prototypes. Use when the user says "prototype", "prototype mode", "build a mockup", "build a prototype UI", "work on a prototype", "design mode", or wants to iterate on a visual concept without production constraints.
---

# Prototype mode

This skill flips the operating model. Prototypes live in `packages/prototypes`
(deployed to prototypes.goodparty.org). They are sandboxed UI surfaces for
designers and PMs to explore ideas with the GoodParty design system. There are
no real users, no real data, no backend. Operate accordingly.

## 1. Enter prototype mode — invert the default operating model

**OFF for this session:**

- System-level correctness concerns (API contracts, data integrity, error handling,
  auth, backend calls, SQS/worker hooks, Prisma, S2S tokens)
- Test-first discipline — no test files, no coverage requirements
- "What breaks in prod" thinking — there is no prod here
- Type strictness in service of safety: explicit `any` annotations are acceptable
  in prototype-only code when they speed up iteration, but parameters and
  variables must still be annotated — implicit `any` fails `tsc --noEmit` in CI
- Backend, data fetching, or network calls of any kind

**ON for this session:**

- Visual craft: layout, spacing, hierarchy, motion, responsiveness
- Communicating the concept clearly and beautifully
- Iteration speed: ship a visible change in every round
- Using the design system well: components, tokens, and patterns from
  `@goodparty_org/styleguide` only — no ad hoc CSS values or one-off color codes
- The yardstick is: "does this clearly and beautifully convey the concept?"
  Not: "is this correct, safe, or production-ready?"

**Invoke the `frontend-design` skill now — it is the bar for "good design" here.**
Don't just gesture at design; load that skill and apply it: visual hierarchy,
whitespace, typography scale, color semantics, motion, and choices that look
intentional rather than templated. A prototype that's structurally correct but
visually flat has missed the point of this surface.

Build only from `@goodparty_org/styleguide` components and its design tokens — no
raw hex values, no hardcoded spacing outside the token scale, no imported UI
libraries outside the styleguide.

**Use the existing component — don't reinvent it.** Before building any UI element
(a nav bar, an input with an action, a card, an AI prompt bar, a badge), check
Storybook for a styleguide component or pattern that already does it, and use that.
Reach for a custom build only when nothing fits. The designer should never have to
say "use the right component" — that's the default.

## 2. Orient onto the right prototype

**New prototype:** invoke the `new-prototype` skill (or, if that skill is not
available, clone an existing `packages/prototypes/app/p/<slug>/` folder into a
new slug directory and update its `meta.ts`). Do not edit any existing prototype
when the intent is to start fresh.

**Returning to existing work:** before editing anything, read every file matching
`packages/prototypes/app/p/*/meta.ts`. List the prototypes you find (slug, title,
description from the `PrototypeMeta` export) and ask the user to confirm which one
to open. Never assume — two prototypes often share similar names or topics.

A `PrototypeMeta` export looks like:

```ts
import type { PrototypeMeta } from '@/shared/prototypeMeta'

const meta: Omit<PrototypeMeta, 'slug'> = {
  title: 'Some Concept',
  description: 'What this prototype explores.',
  author: 'designer@goodparty.org',
  createdAt: '2026-01-01',
  status: 'draft',
}

export default meta
```

Confirm the slug before any edits. Then open the prototype's `page.tsx` and any
adjacent component files to orient on the current state before proposing changes.

## 3. See your work — without opening browsers

Start the dev server once, in the background, and leave it running for the whole
session:

```bash
npm run dev -w packages/prototypes   # http://localhost:4002
```

There are two views of the prototype. Use the right one for each audience:

- **The human watches the Claude Desktop preview viewer.** Point it at
  `http://localhost:4002/p/<slug>` once. With the dev server running, HMR pushes
  every save to that pane in ~1s — no browser windows, no agent round-trip. This is
  the designer's live view; assume it is open and that they see saves immediately.
  You do not need to screenshot for the human's benefit.
- **You (the agent) self-check with the headless Playwright MCP.** When you need to
  _see_ a result to correct your own work, use `browser_navigate` →
  `browser_take_screenshot` against `http://localhost:4002/p/<slug>`. The MCP is
  configured headless + isolated in `.mcp.json`, so it never opens a window and
  reuses one session — never override it to headed, and never use `npx playwright
screenshot`, `open <url>`, the `run` skill, or anything else that launches a
  visible browser. Screenshot only when you genuinely need to verify layout, not
  after every trivial edit.
- **Reference the design system through Storybook — headlessly.** To see a
  styleguide component or pattern in isolation, point the same headless MCP at its
  story iframe: `https://style.goodparty.org/iframe.html?id=<story-id>&viewMode=story`
  (story ids are in `https://style.goodparty.org/index.json`). To learn a
  component's API, read its story source in `packages/styleguide/src/stories/`.
  Storybook — not the component source — is the canonical catalog; details in
  `packages/prototypes/CLAUDE.md`.

If the server won't start, check port 4002 isn't already in use (`lsof -i :4002`)
and that `packages/prototypes` exists. If the package isn't there, its scaffold is
a prerequisite — pause and ask.

## 4. Move fast — this loop should feel instant

Responsiveness is the product here. Optimize the loop:

- **Context is pre-loaded; don't re-explore.** `packages/prototypes/CLAUDE.md`
  carries the reference you need every session — the `<AppShell>` API, the
  org/tab model, and where components and tokens live. Read it once; don't re-grep
  the styleguide each turn.
- **Lean on HMR; skip the heavy gates.** During iteration, never run `tsc`, `lint`,
  the test suite, or `next build` — they burn seconds the loop can't spare. Save,
  let HMR refresh, screenshot only if you need to self-check. Run gates once, at
  ship time.
- **Fan out independent work to subagents — grouped by file.** A batch of feedback
  becomes parallel subagents: items touching _different_ files run at once; items
  touching the _same_ file chain serially (to avoid clobbering). Give each a tight
  brief (the file, the change, the mock data, the design intent).
- **Subagents return code, never browsers.** A subagent makes its edit and returns —
  it must NOT navigate, screenshot, run Playwright, or open anything. Visual
  verification is the main agent's job: **once, at the end of a batch, headless** —
  not per subagent. Spinning a browser per subagent is the #1 cause of windows
  flashing and `about:blank` churn. Keep the visual surface the human's preview pane.

## 5. Guardrails

These are hard limits regardless of what the user asks for in prototype mode:

- **Never launch a visible browser window.** The only way you view rendered UI is
  the headless Playwright MCP (forced headless in `.mcp.json`). No headed browsers,
  no `open <url>`, no `npx playwright screenshot`, no `run` skill for viewing. The
  human's live view is the Claude Desktop preview viewer — you can't access it and
  don't need to.
- **No backend calls.** No `fetch`, no service calls, no auth headers, no S2S
  tokens, no Prisma imports, no SQS, no worker hooks.
- **No auth or data fetching.** All data in prototypes is static or hardcoded.
  Use realistic-looking fake data inline; never wire up a real API or database.
- **No contracts.** Do not touch `packages/contracts` or any cross-service
  payload shape from prototype mode. A prototype that needs to "pretend" to call
  an endpoint mocks the response locally.
- **No required tests.** Do not create test files for prototype code.
- **Never edit `packages/gp-webapp`** from prototype mode. Prototypes are
  sandboxed. If a prototype reveals that a change to the production app is needed,
  note it and surface it to the user as a separate follow-up item.
- **Never edit `packages/styleguide`** from prototype mode. The shared design
  system is consumed here, not modified. If a needed component or token is missing
  from the styleguide, use an inline approximation in the prototype and flag the
  gap to the designer as a potential styleguide contribution — that contribution is
  a separate, deliberate PR with design review.
