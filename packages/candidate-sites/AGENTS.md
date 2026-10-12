# AGENTS.md

Guidance for Claude Code and other AI agents working in `candidate-sites`. Keep this file short — push detail into `docs/`.

## Project

Next.js 15 (App Router) + React 19 + Radix UI + Tailwind 3 app that renders **public candidate websites** authored in `gp-api`. Each request fetches the site's content from `gp-api` server-side and renders. Two entry points: vanity path (`/[vanityPath]`) and custom domain (`Host` header). Deployed on Vercel. There is **no auth** in this repo and **no database** — `gp-api` is the only data source. When a custom-domain request can't resolve to a published site, the route renders a minimal placeholder (just an `<h1>`); when a vanity-path request can't, it 404s. See `README.md` for the user-facing overview.

## Commands (most-used first)

```bash
npm run dev              # next dev --turbopack --port 4001
npm run build            # next typegen + tsc --noEmit (TS 7) + next build
npm run start            # next start (serve the production build)
npm test                 # vitest run
npm run lint             # eslint . (ESLint CLI, flat config)
npm run lint:fix         # eslint . --fix (mutates files — stage first)
npm run format           # prettier -c .   (read-only check)
npm run format:fix       # prettier --write . (mutates files — stage first)
```

Vitest runs the handful of tests this package has (`*.test.ts`, node environment, config in `vitest.config.ts`). It is not a broad suite — the rendering is covered by `next build` and by gp-webapp's tests — so only add a test here when the behaviour cannot be seen from either, as with the client-address forwarding in `app/api/`.

There is **no `npm run typecheck` script.** Type errors surface during `npm run build` (which runs `tsc --noEmit` before `next build`; `next.config.ts` sets `typescript.ignoreBuildErrors` so Next doesn't re-check on the slower TS 6 API) and through the editor's TS server. If you need a one-shot check, run `npx tsc --noEmit`.

## Verify

Reproduce the CI **Validate** job (`.github/workflows/candidate-sites.yml`) before opening a PR. From the repo root:

```bash
npm run lint -w packages/candidate-sites     # eslint . --max-warnings 0
npm run format -w packages/candidate-sites   # prettier -c . (read-only check)
npm test -w packages/candidate-sites         # vitest run
npm run build -w packages/candidate-sites    # tsc --noEmit + next build (typecheck + build smoke)
```

## Pointer table — when in doubt

| Doing                                                            | Read                        |
| ---------------------------------------------------------------- | --------------------------- |
| App shape, env vars, deploy basics                               | `README.md`                 |
| Adding a route, section, or data flow                            | `docs/architecture.md`      |
| Local dev quirks (gp-api wiring, custom-domain trick, port 4001) | `docs/getting-started.md`   |
| AI rule-by-rule code review                                      | `ai-rules/` (git submodule) |
| Why a thing is the way it is                                     | `docs/adr/`                 |

## Code style

- **No semicolons**, single quotes, trailing commas, `printWidth: 80` (`.prettierrc`).
- `unused-imports/no-unused-imports` is **an error**.
- `@stylistic/semi: never` is **an error** — never add a semicolon.
- `@typescript-eslint/no-explicit-any` is **off** — but prefer typed code; `any` is a last resort.
- TypeScript: `strict: true`, `target: ES2017`, `module: esnext`, `moduleResolution: bundler`. Path alias `@/*` → repo root (so `@/helpers/fetchHelper` resolves to `./helpers/fetchHelper`).
- Default exports for page components and route handlers (the App Router convention). Named exports for everything else.
- Functional React components only. `'use client'` directive at the top of files that need browser-only hooks (`useState`, `useEffect`).

## App layout

```
app/
├── layout.tsx                          # root layout — global fonts/styles
├── page.tsx                            # custom-domain entry — resolves by Host header
├── globals.css                         # Tailwind base + globals
├── api/
│   ├── contact-form/[vanityPath]/route.ts   # proxies POST → gp-api /websites/{path}/contact-form
│   ├── websites/[vanityPath]/track-view/route.ts  # proxies POST → gp-api /websites/{path}/track-view
│   └── clientAddressForwarding.test.ts      # both proxies forward the visitor's address
└── [vanityPath]/
    ├── page.tsx                        # vanity-path entry — resolves by /{vanityPath}
    ├── preview/                        # iframe preview route — postMessage-driven
    ├── components/                     # WebsitePage + section components (Hero/About/Contact/...)
    ├── constants/                      # WEBSITE_THEMES, WEBSITE_SECTIONS, WEBSITE_STEPS
    └── types/website.type.ts           # Website shape
helpers/
├── fetchHelper.ts                      # thin fetch wrapper around API_ROOT — returns T | null
├── clientAddress.ts                    # visitor address for the api/ proxies to forward
└── validations.ts
appEnv.ts                               # API_ROOT + IS_PROD/IS_PREVIEW/IS_DEV/IS_LOCAL flags
next.config.ts                          # image domains + global `X-Robots-Tag: noindex`
```

`app/[vanityPath]/components/WebsitePage.tsx` is the rendering core — both entry points hand off to it. Start there if you're adding or fixing a section.

## Data flow (one paragraph)

Both entry points (`app/page.tsx` for custom-domain, `app/[vanityPath]/page.tsx` for vanity-path) call `fetchHelper<Website>(...)` against `gp-api` and pass the resulting `Website` to `WebsitePage`. `WebsitePage` reads `website.content` (hero / about / contact / theme) and `website.campaign` (candidate name / level / state) and renders the section components. **There is no client-side data fetching of the site itself** — everything except the contact-form POST and view-tracking POST goes through server-side `fetch` in the route's RSC. The two `app/api/.../route.ts` proxies exist precisely so client components can `POST` without leaking the API base URL or shape.

## Preview route

`app/[vanityPath]/preview/page.tsx` (and its `PreviewPageClient`) is **not data-fetched**. It listens for a `WEBSITE_DATA` `postMessage` from the parent window — `gp-api`'s editor renders this route in an iframe and pushes draft content in. If you change the `Website` type, also update what the editor posts; otherwise the preview silently breaks.

## Search-engine policy

`next.config.ts` sets `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex` on **every path**. These are public sites that intentionally don't appear in search results. Don't override this header in a route without an explicit reason — it's load-bearing.

## Never

- Never add `'use client'` to a page or layout that's an `async` function. Client components can't be async, so anything that `await`s `params` / `searchParams` / `headers()` (or anything else) must remain a server component. If a client subtree needs that data, fetch it in the server component and pass it down as props.
- Never call `gp-api` directly from a browser-only component. Use the proxy routes under `app/api/` so `NEXT_PUBLIC_API_BASE` (which is exposed to the client by name) doesn't end up baked into a fetch URL with no observability or auth control.
- Never drop `clientAddressHeaders(request)` from a proxy under `app/api/`. gp-api meters those public routes per IP, and without the forwarded address every visitor of every site arrives as this function's egress address and shares one bucket.
- Never remove the `X-Robots-Tag` header in `next.config.ts` without confirming with the team — it's deliberate.
- Never check in env values. Only `.env.example` (when added) belongs in git; real values go in Vercel project settings or local `.env.local`.
- Never edit a file under `ai-rules/` directly — it's a submodule that points at `thegoodparty/ai-rules`. Update it via `git -C ai-rules pull` (and stage the new pin in the parent).

## Environment

- **Node 22.x** — pinned via `.nvmrc` (`22.12.0`) and `engines.node` (`22.x`). Next 15 + React 19 + Turbopack need a modern LTS; the monorepo standardizes on Node 22. Run `nvm use` before installing.
- **npm**, single workspace.
- Required runtime env (set in Vercel or `.env.local`):
  - `NEXT_PUBLIC_API_BASE` — full `gp-api` base URL including `/v1` prefix (defaults to `http://localhost:3000/v1`).
  - `NEXT_PUBLIC_VERCEL_TARGET_ENV` — auto-set by Vercel; drives `appEnv.ts` flags.
- The `postinstall` hook (`scripts/postinstall.js`) initializes the `ai-rules/` submodule. It's a no-op when `.gitmodules` is absent, and on failure it prints a one-line warning and exits 0 so `npm install` still succeeds — the Next build doesn't depend on `ai-rules/`.
