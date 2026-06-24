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

Pull in `frontend-design` sensibilities throughout: visual hierarchy, whitespace,
typography scale, color semantics, interactive affordances. Build only from
`@goodparty_org/styleguide` components and its design tokens — no raw hex values,
no hardcoded spacing outside the token scale, no imported UI libraries outside
the styleguide.

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

## 3. Get the design environment running locally

Start the dev server in the background:

```bash
npm run dev -w packages/prototypes
```

The app runs on port **4002**. Once the server is up, open the prototype in the
browser:

```
http://localhost:4002/p/<slug>
```

Use the `run` skill or the Playwright MCP (`browser_navigate`) to open the URL
and take a screenshot confirming the prototype renders. Verify HMR is live by
confirming the dev server is watching — any saved change should reflect in the
browser within a second or two without a manual reload. Reference the Playwright
MCP for viewport screenshots after each round of edits so the user can see
progress without switching windows.

If the server fails to start, check that port 4002 is not already in use
(`lsof -i :4002`) and that `packages/prototypes` exists in the workspace. If the
package does not exist yet, its scaffold is a prerequisite — pause and ask.

## 4. Guardrails

These are hard limits regardless of what the user asks for in prototype mode:

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
