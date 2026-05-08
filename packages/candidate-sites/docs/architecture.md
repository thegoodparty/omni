# Architecture

A pointer-heavy doc. Detailed conventions live in `CLAUDE.md` and `ai-rules/`.

## Stack

- **Next.js 15** App Router on **React 19**, dev server uses Turbopack on port `4001`.
- **MUI 7** (`@mui/material`, `@mui/icons-material`) + **Emotion** for component styling; **Tailwind 3** for layout / utility classes; **`@tailwindcss/typography`** for prose.
- **TypeScript 5** strict, `target: ES2017`, `module: esnext`, `moduleResolution: bundler`, path alias `@/*` → repo root.
- **ESLint 9** with `next/core-web-vitals + next/typescript`, `unused-imports`, `@stylistic` (forbids semicolons). **Prettier 2** for formatting.
- **Build:** `next build` (Webpack production build). **Dev:** Turbopack via `next dev --turbopack`. Restart `npm run dev` after editing `next.config.ts` or `tsconfig.json` — neither is hot-reloaded.
- **Deploy:** Vercel. Env vars are configured per environment (`production` / `preview` / `development`); `NEXT_PUBLIC_VERCEL_TARGET_ENV` is set automatically.
- **No tests.** No vitest / jest / Playwright config.

## Two entry points (the heart of this app)

Every request lands on **one of two** server-rendered routes:

| Route                                     | When                                                                           | How it resolves the website                  |
| ----------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------- |
| `app/page.tsx` (`/`)                      | Request `Host` header is a custom candidate domain (e.g. `jane-for-mayor.com`) | `GET ${API_ROOT}/websites/by-domain/{host}`  |
| `app/[vanityPath]/page.tsx` (`/jane-doe`) | Request hits the GoodParty.org parent domain at a vanity slug                  | `GET ${API_ROOT}/websites/{vanityPath}/view` |

Both call `fetchHelper<Website>(...)` and hand the resulting `Website` object to **`app/[vanityPath]/components/WebsitePage.tsx`**, which is the single rendering core. The custom-domain entry imports from the vanity-path tree on purpose — there's one set of components, two ways to find which `Website` to feed them.

If `website.status !== 'published'`:

- The vanity-path route calls `notFound()` → renders `not-found.tsx` (or the default 404).
- The custom-domain route renders an inline minimal placeholder (just an `<h1>` — see `app/page.tsx`).

## Module shape

```
app/
├── layout.tsx                              # root <html>/<body> + global font + Tailwind globals
├── globals.css                             # @tailwind base/components/utilities + custom CSS
├── page.tsx                                # custom-domain entry
├── api/                                    # server-side proxy endpoints (see "API proxy routes" below)
│   ├── contact-form/[vanityPath]/route.ts
│   └── websites/[vanityPath]/track-view/route.ts
├── shared/                                 # reused across entries
│   ├── buttons/   inputs/   typography/    # MUI / Tailwind wrappers
│   └── utils/                              # candidateMetaData, getImageDimensions, getUserFullName, etc.
└── [vanityPath]/
    ├── page.tsx                            # vanity-path entry
    ├── preview/                            # iframe-driven preview (postMessage)
    │   ├── page.tsx
    │   └── PreviewPageClient.tsx           # 'use client' — listens for WEBSITE_DATA messages
    ├── components/                         # WebsitePage + section components
    │   ├── WebsitePage.tsx                 # the rendering core
    │   ├── HeroSection.tsx
    │   ├── AboutSection.tsx
    │   ├── ContactSection.tsx
    │   ├── PrivacyPolicyModal.tsx
    │   ├── WebsiteHeader.tsx
    │   ├── WebsiteFooter.tsx
    │   └── WebsiteViewTracker.tsx          # 'use client' — fires the track-view POST
    ├── constants/                          # theme palette + nav step definitions
    │   ├── websiteContent.const.ts         # WEBSITE_THEMES (color tokens per theme name)
    │   └── websiteNavigation.const.ts      # WEBSITE_SECTIONS, WEBSITE_STEPS
    └── types/website.type.ts               # the Website shape (mirrors gp-api's website model)
helpers/
├── fetchHelper.ts                          # fetch wrapper — returns T | null, swallows non-2xx
└── validations.ts
appEnv.ts                                   # API_ROOT, IS_PROD/IS_PREVIEW/IS_DEV/IS_LOCAL flags
next.config.ts                              # image domains, NEXT_PUBLIC_API_BASE, X-Robots-Tag header
```

`WebsitePage.tsx` is the canonical reference for how a section is wired up.

## Data flow

```
Browser request (vanity path or custom domain)
        │
        ▼  Next.js routing
    app/page.tsx   OR   app/[vanityPath]/page.tsx
        │                       │
        │  Host header          │  params.vanityPath
        ▼                       ▼
    fetchHelper<Website>('websites/by-domain/' + host)
    fetchHelper<Website>('websites/' + vanityPath + '/view')
        │
        ▼
    Website | null
        │     └─ null  → notFound() / fallback page
        ▼
    <WebsitePage website={...} privacyPolicy={?} imageDimensions={?} />
        │
        ▼  React Server Component → HTML to browser
    Browser hydrates 'use client' children:
      • WebsiteViewTracker → POST /api/websites/[vanityPath]/track-view (proxy → gp-api)
      • Contact form       → POST /api/contact-form/[vanityPath]       (proxy → gp-api)
      • PrivacyPolicyModal → toggled via ?privacy=true
```

Every server-side fetch goes through `helpers/fetchHelper.ts`, which:

- Prefixes `${API_ROOT}/`.
- JSON-stringifies object bodies.
- Returns `T | null` on any non-2xx, empty body, or JSON parse error — by design, **callers never throw**, they just check for `null` and fall back.

## API proxy routes

`app/api/contact-form/[vanityPath]/route.ts` and `app/api/websites/[vanityPath]/track-view/route.ts` are **server-side proxies**. Client components POST to these Next routes; the routes re-call `gp-api` via `fetchHelper`. This pattern exists so:

- Browser code never directly calls `gp-api`. The base URL is `NEXT_PUBLIC_*` so it would technically work, but the proxy gives us a place to add headers / observability / rate limiting later without touching browser code.
- Cross-origin / CORS doesn't enter the picture.

If you add a new client → gp-api write path, add a proxy route. Don't `fetch(NEXT_PUBLIC_API_BASE)` from a client component.

## Preview route

`app/[vanityPath]/preview/page.tsx` is rendered inside an iframe by `gp-api`'s editor and **does not fetch its own data**. `PreviewPageClient.tsx` listens for `window.message` events of shape `{ type: 'WEBSITE_DATA', data: Website, step?: number }` and re-renders `WebsitePage` with that data. Two implications:

1. The preview route trusts whatever the parent posts. It only works inside `gp-api`'s editor frame.
2. Changes to the `Website` type **must** be coordinated with the editor in `gp-api` — otherwise the editor posts a payload the preview can't render and the iframe goes blank.

## Cross-service edges

| Direction                      | Service         | Protocol               | Auth                  | Notes                                      |
| ------------------------------ | --------------- | ---------------------- | --------------------- | ------------------------------------------ |
| outbound (RSC + proxy routes)  | `gp-api`        | HTTP via `fetchHelper` | none                  | Public read endpoints + public-form writes |
| inbound (iframe `postMessage`) | `gp-api` editor | `window.postMessage`   | none (origin-trusted) | Preview route only                         |

There is **no `Authorization` header** anywhere in this repo. The endpoints we hit on `gp-api` are public. If that ever changes, plumbing a token would mean: add it as a server-only env var, accept it inside the proxy routes only, and never expose it to the browser bundle.

## Bootstrap

There's no app bootstrap to speak of. Next.js owns the lifecycle:

1. `next.config.ts` ships image-domain allowlist + the global `X-Robots-Tag` header + the `NEXT_PUBLIC_API_BASE` env passthrough.
2. `app/layout.tsx` sets up `<html>`/`<body>`, fonts, and global CSS.
3. Each page is an async server component; it `await`s `params` / `searchParams` / `headers()`, fetches its data, and returns JSX.
4. `'use client'` sub-trees hydrate in the browser.

## Search-engine policy

`next.config.ts`:

```ts
async headers() {
  return [{ source: '/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive, nosnippet, noimageindex' }] }]
}
```

Every path on every domain is blocked from search engines. This is intentional — these are personal candidate sites and we don't want them ranking organically. Removing or scoping this header is a product decision, not a bug fix.

## Key patterns

- **Two entries, one renderer.** New site features go in `WebsitePage` and its section components, not in either entry route.
- **Types come from `[vanityPath]/types/website.type.ts`.** When `gp-api` ships a type contract for the website model, switch this to a re-export and delete the local copy. Until then, this file is the source of truth.
- **`fetchHelper` returns `T | null`, never throws.** New callers should follow the same shape — return null for "not found" / "API hiccup" and let the page decide what to render.
- **Proxy, don't fetch directly.** Browser → `/api/...` → gp-api. Always two hops for writes; one server-side hop for reads.
- **`appEnv.ts` is the only place env-derived flags live.** Don't sprinkle `process.env.NEXT_PUBLIC_*` reads through component code — import the named flag from `appEnv`.

## ADRs

`docs/adr/` exists but is empty. Add one when a non-obvious decision lands (e.g., why two entries instead of route groups, why MUI + Tailwind both, why `fetchHelper` returns `null` instead of throwing, why `noindex` everywhere). Use `ai-rules/adr-template.md` as the starting point and number sequentially (`0001-...md`, `0002-...md`).
