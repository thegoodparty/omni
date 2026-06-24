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

## Design system

Components: `import { Button, ... } from '@goodparty_org/styleguide'`

CSS tokens are loaded in `app/globals.css` from `../../styleguide/src/`.

The `@styleguide` path alias resolves to `../styleguide/src` (set in tsconfig.json)
and is needed because styleguide components import each other via that alias.

## Skill

Use the `prototype` skill to enter prototype mode and iterate on UI.
Use the `new-prototype` skill to scaffold a fresh prototype folder.
