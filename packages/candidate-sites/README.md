# Candidate Sites

Next.js app that renders public candidate websites authored in [`gp-api`](https://github.com/goodparty-org/gp-api). Each candidate's website content (hero, about, contact, theme, etc.) is fetched from `gp-api` and rendered server-side.

## How it works

A candidate site can be reached two ways, each handled by a different route:

1. **Custom domain** — `app/page.tsx`
   Used when a candidate has a custom domain registered through `gp-api` (e.g. `jane-for-mayor.com`). The route reads the request `Host` header and resolves the website via:

   ```
   GET ${NEXT_PUBLIC_API_BASE}/websites/by-domain/{host}
   ```

2. **Vanity path** — `app/[vanityPath]/page.tsx`
   Used for sites served under the GoodParty.org domain at `/{vanityPath}` (e.g. `goodparty.org/jane-doe`). The route resolves the website via:

   ```
   GET ${NEXT_PUBLIC_API_BASE}/websites/{vanityPath}/view
   ```

In both cases the result is rendered by `app/[vanityPath]/components/WebsitePage.tsx`. Sites whose `status` is not `published` are not shown. A `?privacy=true` query param opens the privacy-policy modal.

There is also a preview route at `app/[vanityPath]/preview/page.tsx` used by `gp-api` to render in-progress edits before publish.

## Requirements

- Node.js 22.x (pinned via `.nvmrc` / `engines.node`; run `nvm use`)
- npm (a `package-lock.json` is committed)
- A running `gp-api` instance to fetch website data from

## Environment variables

Create a `.env.local` (or set these in your deployment environment):

| Variable                        | Description                                                                                              | Example                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `NEXT_PUBLIC_API_BASE`          | Base URL of `gp-api`, including the version prefix. Falls back to `http://localhost:3000/v1` when unset. | `https://gp-api.goodparty.org/v1` |
| `NEXT_PUBLIC_VERCEL_TARGET_ENV` | Set automatically on Vercel (`production` / `preview` / `development`); used by `appEnv.ts` flags.       | `production`                      |

## Getting started

```bash
npm install
npm run dev
```

The dev server runs on [http://localhost:4001](http://localhost:4001) (configured via `next dev --turbopack --port 4001` in `package.json`).

To exercise the **vanity-path** flow locally, hit `http://localhost:4001/{vanityPath}` for any published website in the connected `gp-api`.

To exercise the **custom-domain** flow locally, point a hostname at `localhost:4001` (e.g. via `/etc/hosts`) so that the `Host` header matches a domain registered in `gp-api`.

## Scripts

| Script                          | Description                                          |
| ------------------------------- | ---------------------------------------------------- |
| `npm run dev`                   | Start the Next.js dev server (Turbopack, port 4001). |
| `npm run build`                 | Production build.                                    |
| `npm run start`                 | Run the production build.                            |
| `npm run lint` / `lint:fix`     | ESLint.                                              |
| `npm run format` / `format:fix` | Prettier.                                            |

## Project layout

```
app/
  page.tsx                       # custom-domain entry point
  [vanityPath]/
    page.tsx                     # vanity-path entry point
    preview/                     # preview route used by gp-api editor
    components/                  # WebsitePage and section components
    constants/                   # theme + navigation constants
    types/                       # Website type
  shared/                        # shared inputs, buttons, typography, utils
helpers/
  fetchHelper.ts                 # thin wrapper around fetch against API_ROOT
appEnv.ts                        # API_ROOT + environment flags
```

## Deployment

Deployed on Vercel. Make sure `NEXT_PUBLIC_API_BASE` is set per environment so each deployment talks to the correct `gp-api`.
