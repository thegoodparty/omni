# @goodparty_org/prototypes

Backend-free UI prototype gallery for the GoodParty design system. No auth, no API
calls, no data fetching. Designers and engineers build and explore UI here before
wiring things into gp-webapp.

## Hard rules

- No backend calls, no Clerk, no auth, no middleware.
- No production data or real API routes.
- Design system only: use `@goodparty_org/styleguide` components and tokens.
- Tests are not required for prototypes.

## How to run

```bash
npm run dev -w packages/prototypes   # starts on http://localhost:4002
npm run build -w packages/prototypes # production build check
```

## Where prototypes live

Each prototype is a folder under `app/p/<slug>/` with its own `page.tsx`.

A prototype may keep its own nested `CLAUDE.md` with per-prototype conventions
(auto-loaded when you edit that folder). See
[`app/p/serve-nav-kit/CLAUDE.md`](app/p/serve-nav-kit/CLAUDE.md) — the
source-fidelity, data-privacy, and design-system rules agreed for the Voter
Outreach port.

## Design system reference (read this once — don't re-explore each session)

**Storybook is the catalog.** Every component, foundation (colors, icons, shadows,
borders), and pattern lives there as a rendered, documented story — it is the
canonical reference for what exists and how it looks, better than reading source.

- Browse it at **https://style.goodparty.org** (also the designer's reference).
- To learn a component's real API + composition, read its story source in
  `packages/styleguide/src/stories/*.stories.tsx` — these are copy-pasteable usage.
- To _see_ one component in isolation without any browser window, point the
  **headless Playwright MCP** at the story iframe, e.g.
  `https://style.goodparty.org/iframe.html?id=patterns-product-navigation--elected-office&viewMode=story`
  (story ids are in `https://style.goodparty.org/index.json`).

Import everything from the package: `import { Button, Card, ... } from '@goodparty_org/styleguide'`.
Never use raw hex, Tailwind default palette, or spacing outside the token scale —
tokens are loaded in `app/globals.css` from `../../styleguide/src/`. The `@styleguide`
alias (→ `../styleguide/src`, in tsconfig.json) exists because styleguide components
import each other through it.

## The shell: `<AppShell>`

Prototypes mount the shared shell, which replicates the real gp-webapp dashboard
chrome (org-picker header, nav rail, account footer, mobile drawer). It is driven by
data — `userName` + a list of orgs, each with its own nav tabs. The org picker
switches orgs (this is how Serve vs Win is modeled):

The types `@/shared/AppShell` exports (for reference — don't redeclare them):

```ts
type PrototypeTab = {
  slug: string
  label: string
  icon: LucideIcon
  component: ReactNode
}
type ShellOrg = {
  id: string
  name: string
  isPro: boolean
  tabs: PrototypeTab[]
}
```

A prototype's `page.tsx` imports and uses them:

```tsx
import { AppShell, type ShellOrg } from '@/shared/AppShell'

const orgs: ShellOrg[] = [
  {
    id: 'serve',
    name: 'Pittsboro Town Council',
    isPro: false,
    tabs: [
      /* ... */
    ],
  },
]

const Page = () => <AppShell userName="Renee Wells" orgs={orgs} />
```

`app/p/example/` is the reference prototype — clone it to start a new one.

## Skill

Use the `prototype` skill to enter prototype mode and iterate on UI.
Use the `new-prototype` skill to scaffold a fresh prototype folder.
