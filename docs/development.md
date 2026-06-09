# Local development

## First-time setup

```bash
git clone --recurse-submodules git@github.com:thegoodparty/omni.git
cd omni
nvm use          # Node pinned in .nvmrc (22.12.0)
npm install      # installs every workspace; inits the ai-rules submodule
```

`npm install` runs a `postinstall` that initializes the `ai-rules` git submodule. If
`ls ai-rules/` is empty, run `git submodule update --init --recursive ai-rules`.

Each app needs its own local env files. Copy from each app's `.env.example` /
`.env.local` template before starting it.

## Run the core loop

```bash
npm run dev      # Postgres (gp-api docker compose) + gp-api (:3000) + gp-webapp (:4000)
```

`scripts/dev.sh` boots the most common stack. Other apps start the same way via
their workspace name.

## Per-app commands (npm workspaces)

```bash
npm run start:dev -w gp-api          # gp-api on :3000
npm run dev       -w good-party      # gp-webapp (package name is "good-party") on :4000
npm run start:dev -w election-api    # :3001
npm run start:dev -w people-api      # :3002
npm run dev       -w gp-admin        # :3500
npm run dev       -w candidate-sites # :4001
```

The web app's workspace name is `good-party`, not `gp-webapp` — use that with `-w`.

## Prisma

Generate clients for all three Prisma backends from the root:

```bash
npm run generate:prisma            # gp-api + election-api + people-api
npm run generate:prisma:gp-api     # one service
```

gp-api migrations run from inside its workspace (`npm run migrate:dev -w gp-api`).
See `packages/gp-api/prisma/CLAUDE.md`.

## Per-app detail

Before deep work in an app, read its `CLAUDE.md` (commands, patterns, gotchas):
`packages/gp-api/CLAUDE.md`, `packages/gp-webapp/CLAUDE.md`, and the nested ones in
feature folders.
