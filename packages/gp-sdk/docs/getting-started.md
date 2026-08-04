# Getting Started

First-time setup for `gp-sdk` on macOS / Linux.

## Prerequisites

- **Node** matching `.nvmrc` (`24.13.0`). With `nvm`: `nvm install && nvm use`.
- **npm** (ships with Node).

There's no database, no service to run, and no env file. This is a library — `npm install && npm run build` is the entire local loop.

## Clone

This repo uses `ai-rules` as a git submodule. Clone with `--recursive`:

```bash
git clone --recursive git@github.com:thegoodparty/gp-sdk.git
cd gp-sdk
```

If you already cloned without `--recursive`:

```bash
git submodule update --init --recursive
```

`npm install` runs the same command via the `postinstall` hook **when run inside this repo** (the hook is gated on `.gitmodules`), so a forgotten `--recursive` self-corrects on the next install. The hook is a no-op when this package is installed as a dependency by another repo — `gp-admin`, `gp-api`, `gp-webapp` etc. don't shell out to `git` on `npm install`.

## Install + build

```bash
nvm use            # if you use nvm
npm install        # also fires postinstall → submodule init
npm run build      # one-shot build; outputs to ./dist
```

## Watch mode for local development

```bash
npm run dev        # tsup --watch — rebuilds dist/ on every src/ change
```

Pair this with the linking step below to iterate against a real consumer.

## Linking into a consumer locally (to test changes before publishing)

There are two reliable patterns. Pick one — don't mix.

### Option A — `npm link` (fast, occasionally flaky)

In this repo:

```bash
npm run build      # or `npm run dev` in a separate terminal for live rebuilds
npm link
```

In the consumer (e.g. `gp-admin`):

```bash
npm link @goodparty_org/sdk
# (leave `@goodparty_org/sdk` in package.json untouched — link overrides it)
```

When done:

```bash
# in the consumer
npm unlink @goodparty_org/sdk && npm install
# in this repo
npm unlink
```

The classic gotcha: if the consumer uses peerDeps that overlap with `gp-sdk`'s deps (e.g. `@clerk/backend`), Node may end up with two copies of the same lib in different `node_modules`, which produces silent bugs — duplicated `ClerkService` token caches, doubled renewal timers, or surprising `import` resolution. Option B avoids this.

### Option B — `file:` protocol (robust, slower iteration)

In the consumer's `package.json`:

```json
{
  "dependencies": {
    "@goodparty_org/sdk": "file:../gp-sdk"
  }
}
```

Then `npm install` in the consumer. After every change in `gp-sdk`, run `npm run build` here and `npm install` (or `npm i @goodparty_org/sdk` to refresh) in the consumer. Slower than `link`, but bundling matches what consumers will actually install from npm.

## Verify (the same things CI runs)

```bash
npm run typecheck       # tsc --noEmit
npm run lint            # eslint --quiet (read-only)
npm run format:check    # prettier --check
npm run build           # tsup
```

CI (`.github/workflows/ci.yml`) runs exactly these four on every push to a non-main branch — if they all pass locally, CI will pass.

## Linting / formatting

```bash
npm run lint:fix        # eslint --fix; mutates files — stage first
npm run format          # prettier --write; mutates files — stage first
npm run lint-format     # both
```

There's no test command and no test framework configured. Don't add a `test` script unless you're also adding tests + wiring them into CI.

## Internal Workspace Package

In `omni`, this package is not published from this workspace. Consumers depend on
`@goodparty_org/sdk` through npm workspaces, so SDK and consumer changes should
land together when the public API changes.

Before opening a PR that changes exported SDK types or behavior, build the
contracts package first, then run the SDK validate commands from the monorepo
root.

## Talking to the API locally

Set `GP_MACHINE_SECRET` (a Clerk M2M secret) and pick a `gpApiRootUrl`:

```typescript
import { GoodPartyClient } from '@goodparty_org/sdk'

const client = await GoodPartyClient.create({
  m2mSecret: process.env.GP_MACHINE_SECRET!,
  gpApiRootUrl: 'http://localhost:4000/v1', // or the qa / prod URL
})

const user = await client.users.get(1)
console.log(user)

client.destroy() // important — stops the token renewal timer
```

Forgetting `client.destroy()` will keep the process alive after your script finishes.

## Common gotchas

- **`ai-rules/` is empty after clone** → run `git submodule update --init --recursive` (or `npm install` to trigger it via `postinstall`).
- **Process won't exit after using the client** → you forgot `client.destroy()`. The Clerk renewal timer keeps the event loop alive.
- **`SdkError: 0 — Unknown error`** → almost always a network problem (DNS, no internet, unreachable `gpApiRootUrl`) — `ofetch` couldn't reach the server. Real HTTP errors come back with a real status.
- **`npm link` works locally but fails in another consumer** → see "Linking into a consumer" above. Switch to Option B (`file:`) when in doubt.
- **CI red on `format:check`** → run `npm run format` locally and recommit. Prettier disagreements are the most common CI failure on this repo.

## Where to go next

- `CLAUDE.md` — agent + style guide for the repo.
- `docs/architecture.md` — module shape, public surface, build pipeline.
- `ai-rules/` — org-wide review rules and skills (submodule).
