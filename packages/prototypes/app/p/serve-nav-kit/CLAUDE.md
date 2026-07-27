# serve-nav-kit — Voter Outreach prototype rules

This prototype is the Win product's **Voter Outreach** section, ported from the
Lovable app onto `@goodparty_org/styleguide`. These rules were agreed while
building it — follow them when editing anything under this folder. This file
auto-loads as context when you work here.

Deployed as a public preview per branch (`prototypes-pr-<N>-good-party.vercel.app/p/serve-nav-kit`)
and, on merge to `develop`, to `prototypes.goodparty.org/p/serve-nav-kit`.

## 1. Source fidelity — this is a faithful port

- **Source of truth** is the Lovable app tree (`app-code/src`): channel flows in
  `components/outreach/*`, door knocking in `pages/DoorKnocking.tsx` +
  `components/door-knocking/*`, phone bank in `pages/PhoneBankSession.tsx`.
- **Port all user-facing text verbatim.** Add nothing of your own; remove copy the
  port invents. Keep source wording even when it looks like a typo — flag it, don't
  silently "fix" it.
- **Match logic and functionality** to the source, step by step.
- **Preserve the source's dead-ends and quirks — do not "fix" them.** They are
  intentional parity, not bugs (e.g. the robocall sub-2-second recording gate; a
  note save resetting an in-progress call draft). When the port has _lost_ source
  behaviour, restore it (e.g. the "Send now" 48-hour notice, empty-filter gating).

## 2. Data & privacy — hard rule

- Voter/L2 data is restricted. **Never reproduce real voter PII** — no real names,
  addresses, streets, or place-level data (e.g. no Blanco County records).
- Use **synthetic, generated, PII-free** data. Keep synthetic names even where the
  source uses real ones.

## 3. Backend-free

- No auth, no API, no data fetching, no network, no persistence (no
  `sessionStorage`/`localStorage`/router).
- **Stub backend-only behaviour** the way the other flows already do: sending,
  payment, PDF/ZIP download, and AI generation are mocked (`setTimeout` + `toast` +
  canned content). Never add a real backend or a heavy dep for these.
- Full-screen sub-experiences (door knocking, the phone-bank calling session) are
  **state-driven takeovers** held in the screen's own state (like `doorOpen`), not
  routes.

## 4. Design system only

- Use **only** `@goodparty_org/styleguide` components and its tokens. No raw hex, no
  default Tailwind palette outside the token scale.
- **Never hand-roll a UI element if a DS component exists.** If one is missing, flag
  the gap in `DS_COMPONENT_UPDATES.md` — don't invent a bespoke replacement.
- **Storybook (https://style.goodparty.org) is the source of truth** for what
  components exist and how they look; screenshots are only previews.
- Local components with no DS equivalent are documented in `NEW_COMPONENTS.md`.

## 5. Tokens & colour

- Focus: `ring-primary-focus`. Field errors: `aria-invalid` (the DS paints it).
  Destructive actions: `variant="destructive"`. Don't add `shadow-none` to `Card`
  (it has no default shadow).
- Categorical/series colours use the DS `--data-chart-*` palette, not raw shades.
- Documented raw-palette exceptions (no semantic token fits): `bg-yellow-400` /
  `fill-yellow-400` for the "Not home" status; `bg-emerald-50` for the synthetic
  map background.
- Legend/filter counts follow the source format: a plain trailing count on the
  legend; **no** count on filter pills.
- Sentence case in headings and labels.

## 6. Run, preview, iterate

- Local: `npm run dev -w packages/prototypes` → http://localhost:4002/p/serve-nav-kit
- Iterate with Claude Code: say **"put me in prototype mode"** (or `/prototype`).
  Scaffold a brand-new prototype: **"new prototype"** (or `/new-prototype`).
- Preview per branch: push → PR → `prototypes-pr-<N>-good-party.vercel.app`. Prod
  updates only on merge to `develop`.

## 7. Quality gates

- Before committing: `npm run types -w packages/prototypes` (typegen + `tsc`), then
  `npm run lint -w packages/prototypes` (eslint + prettier), then
  `npm run test -w packages/prototypes` (vitest), then `npx next build`.
- Commit/PR messages explain _why_, not _what_; no "test plan"; no
  `Co-Authored-By` / "Created by Claude" footers; GitHub content in English.
- Verify before deleting: grep first, report findings, then remove.
