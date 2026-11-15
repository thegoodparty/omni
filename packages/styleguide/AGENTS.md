# @goodparty_org/styleguide

Standalone design system package. Components, CSS tokens, and hooks consumed as
source (no dist build) by `packages/gp-webapp`.

## Key facts

- Source-consumed: no build step, Next.js transpiles via `transpilePackages`.
- `@styleguide` path alias in gp-webapp resolves to `packages/styleguide/src`.
- Zero imports outside `src/` — no `@shared`, no relative escapes into other packages.
- Prototypes copy these components as plain-HTML classes in
  `.claude/skills/ux-review-options/assets/gp-ui.css`. Changing a component's
  look, variants or sizes? Change its block there in the same PR, or prototypes
  drift from the product.
- CSS files (`design-tokens.css`, `tailwind-theme.css`, `typography.css`) are
  imported directly from gp-webapp's `globals.css` via relative `../../styleguide/src/` paths.

## Structure

```
src/
  components/ui/   # React components (shadcn/ui based)
  hooks/           # use-mobile.ts (breakpoints inlined, no @shared dep)
  lib/utils.ts     # cn() utility
  index.ts         # Re-exports for components + cn
  design-tokens.css
  tailwind-theme.css
  styleguide-scope.css
  typography.css
```

## Adding a component

A new component, or a new variant, needs the team's approval in
#tmp-design-agent first, per `docs/product-design.md` §7: propose it in Part 4
of `docs/product-design-gaps.md`.

1. Create `src/components/ui/newcomponent.tsx`
2. Add `data-slot="component-name"` to the root element
3. Put a JSDoc block with an `@summary` tag directly above the component:
   one line on when to use it, and what to use instead where a sibling is
   easy to confuse with it. Then run `npm run docs:components -w packages/styleguide`.
4. Export from `src/components/ui/index.ts`

## Component index

`COMPONENTS.md` lists every component with its `@summary`. Agents read it to pick
a component before building UI, so the summary is the part of a component most
likely to be read. It is generated: change the tag, never the file. CI
(`npm run check:components-doc`) fails if the file is stale or a component file
has no `@summary`.

```tsx
/**
 * Optional: a non-obvious rule an agent would get wrong.
 *
 * @summary Use for a short confirmation or one blocking choice. For a flow, use a page.
 */
const Dialog = ...
```

## Tests

Component tests run in this package's own Vitest (jsdom + Testing Library),
configured in `vitest.config.ts` / `vitest.setup.ts`. CI runs them via
`.github/workflows/styleguide.yml`.

```bash
# from repo root
npm run test -w packages/styleguide
```

Co-locate `*.test.tsx` next to the component (`src/components/ui/switch.test.tsx`)
and import it with a relative path.
