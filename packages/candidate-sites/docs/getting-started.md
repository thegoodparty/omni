# Getting Started

First-time setup for `candidate-sites` on macOS / Linux. The user-facing overview lives in `README.md` — this doc covers Claude-specific dev quirks and gotchas that the README doesn't.

## Prerequisites

- **Node 20+** (no `.nvmrc` is committed; Next.js 15 + React 19 + Turbopack realistically need 20+).
- **npm** (a `package-lock.json` is committed).
- A reachable `gp-api` to read website data from. Easiest is a local `gp-api` on port 3000 — see [`thegoodparty/gp-api`](https://github.com/thegoodparty/gp-api) for setup.

## Clone

This repo uses `ai-rules` as a git submodule. Clone with `--recursive`:

```bash
git clone --recursive git@github.com:thegoodparty/candidate-sites.git
cd candidate-sites
```

If you already cloned without `--recursive`:

```bash
git submodule update --init --recursive
```

`npm install` runs the same command via the `postinstall` hook (`scripts/postinstall.js`), so a forgotten `--recursive` self-corrects on the next install. The hook:

- No-ops when `.gitmodules` is absent (tarball / non-git contexts).
- On failure, prints a one-line warning and **exits 0** so `npm install` still succeeds. If you see that warning, run `git submodule update --init --recursive` manually — `ai-rules/` will be empty until you do, but the Next build does not depend on it.

## Configure environment

Create `.env.local` at the repo root:

```bash
# Required (defaults to http://localhost:3000/v1 if unset)
NEXT_PUBLIC_API_BASE=http://localhost:3000/v1
```

| Var                             | Default for local          | Notes                                                                                                                                                                                        |
| ------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_BASE`          | `http://localhost:3000/v1` | Full `gp-api` base URL **including** the `/v1` prefix. Used by `appEnv.ts` and `helpers/fetchHelper.ts`.                                                                                     |
| `NEXT_PUBLIC_VERCEL_TARGET_ENV` | (unset)                    | Vercel sets this automatically on hosted envs (`production` / `preview` / `development`). Locally it's unset; `IS_LOCAL` is then derived from `NEXT_PUBLIC_API_BASE` containing `localhost`. |

There is no auth env. This repo doesn't talk to any system that requires a token — `gp-api`'s public endpoints are the entire surface.

## Install + run

```bash
npm install      # also fires postinstall → submodule init
npm run dev      # http://localhost:4001 (Turbopack)
```

The dev port is **4001** (set in `package.json`'s `dev` script). If you also run `gp-api` on 3000 and something else on 4000, no conflict.

### Verifying the install

```bash
ls ai-rules/             # should NOT be empty (submodule init worked)
ls dist/ 2>/dev/null     # there is no dist/ — build outputs go to .next/
```

## Talking to a local `gp-api`

Both entry points need at least one `published` website in `gp-api` to render anything other than the fallback. Two flows:

### Vanity-path flow (the easy one)

```bash
# Find a published vanity path in your local gp-api, then visit:
open http://localhost:4001/<vanityPath>
```

The page calls `GET ${API_ROOT}/websites/<vanityPath>/view`. If that returns null or the website's `status !== 'published'`, you'll get a 404.

### Custom-domain flow (the trickier one)

The custom-domain route reads the request `Host` header and calls `GET ${API_ROOT}/websites/by-domain/{host}`. To exercise this locally without registering a domain:

1. Pick a domain that's registered in your local `gp-api` (e.g. `jane-for-mayor.com`).
2. Add it to `/etc/hosts`:
   ```bash
   sudo sh -c 'echo "127.0.0.1 jane-for-mayor.com" >> /etc/hosts'
   ```
3. (macOS only, if the change doesn't take effect) flush DNS:
   ```bash
   sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder
   ```
4. Visit `http://jane-for-mayor.com:4001` (note the explicit port — `/etc/hosts` only maps the hostname, not the port).

Remember to remove the line when you're done.

### Preview-route flow

`app/[vanityPath]/preview/page.tsx` is **iframe-only** — it doesn't fetch its own data. Direct visits show "Loading preview..." for 3 seconds and then 404. To exercise it, run `gp-api`'s editor against this dev server (`gp-api` embeds `http://localhost:4001/<vanity>/preview` in an iframe and posts a `WEBSITE_DATA` message).

## Verify (the same things CI / production runs)

```bash
npm run lint        # next lint  — read-only
npm run format      # prettier -c .  — read-only
npm run build       # next build  — type-checks during build
```

`next build` is the only thing that actually type-checks the whole repo. There's no separate `typecheck` script. Run `npx tsc --noEmit` if you want a type-only check.

## Linting / formatting

```bash
npm run lint:fix     # next lint --fix; mutates files — stage first
npm run format:fix   # prettier --write .; mutates files — stage first
```

`next lint --fix` will rewrite formatting + auto-fixable rules across the touched files. Stage your work before running it so you can audit the diff.

## Deployment

This repo deploys to Vercel. There's nothing to do here — Vercel watches `master` (or whichever branch is configured as the production branch). Make sure each Vercel environment has the right `NEXT_PUBLIC_API_BASE` pointed at the corresponding `gp-api` environment.

There are **no tests** wired into CI. If you add tests, add the framework and the CI step in the same change.

## Common gotchas

- **`ai-rules/` is empty after clone** → run `git submodule update --init --recursive`, or `npm install` to trigger the `postinstall` hook.
- **404 on a vanity path that should work** → `gp-api` returns null or the site's `status` isn't `published`. Check the response in your gp-api logs.
- **Custom-domain route 404s but `/etc/hosts` entry exists** → you forgot the `:4001` port. The browser only adds default ports (`:80` / `:443`); a local dev server on 4001 needs to be explicit in the URL.
- **`Failed to parse JSON response`** in the dev console → `fetchHelper` got a non-JSON body. Usually means `gp-api` returned an HTML error page; check the request shape.
- **Type error after editing `Website`** → `gp-api`'s editor posts a `Website`-shaped payload to the preview route. If you tighten the type here, also coordinate with the editor in `gp-api` so it keeps posting valid data.
- **Hot reload not picking up a file** → Turbopack occasionally misses changes outside `app/`. Restart `npm run dev` if a `helpers/` or `appEnv.ts` change isn't reflected.
- **`NEXT_PUBLIC_API_BASE` change doesn't take effect** → it's read at build/start time, not on every request. Restart the dev server after editing `.env.local`.

## Where to go next

- `README.md` — user-facing overview (start here if you're a new contributor).
- `CLAUDE.md` — agent + style guide for the repo.
- `docs/architecture.md` — module shape, two-entries-one-renderer design, data flow.
- `ai-rules/` — org-wide review rules and skills (submodule).
