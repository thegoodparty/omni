# @goodparty_org/styleguide

Standalone design system package. Components, CSS tokens, and hooks consumed as
source (no dist build) by `packages/gp-webapp` and `packages/prototypes`.

## Key facts

- Source-consumed: no build step, Next.js transpiles via `transpilePackages`.
- `@styleguide` path alias in gp-webapp resolves to `packages/styleguide/src`.
- Zero imports outside `src/` — no `@shared`, no relative escapes into other packages.
- CSS files (`design-tokens.css`, `tailwind-theme.css`, `typography.css`) are
  imported directly from gp-webapp's `globals.css` via relative `../../styleguide/src/` paths.

## Structure

```
src/
  components/ui/   # React components (shadcn/ui based)
  hooks/           # use-mobile.ts (breakpoints inlined, no @shared dep)
  lib/utils.ts     # cn() utility
  stories/         # Storybook stories (excluded from tsc)
  index.ts         # Re-exports for components + cn
  design-tokens.css
  tailwind-theme.css
  styleguide-scope.css
  typography.css
```

## Adding a component

1. Create `src/components/ui/newcomponent.tsx`
2. Add `data-slot="component-name"` to the root element
3. Export from `src/components/ui/index.ts`
4. Create story in `src/stories/NewComponent.stories.tsx`

## Storybook

Storybook config lives in `packages/gp-webapp/.storybook/`. Stories are discovered
via the glob `../../styleguide/src/stories/**/*.stories.*` in `main.ts`.

```bash
# from repo root
npm run storybook -w packages/gp-webapp
npm run build-storybook -w packages/gp-webapp
```
