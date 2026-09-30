# Local development

## First-time setup

```bash
git clone --recurse-submodules git@github.com:thegoodparty/omni.git
cd omni
npm run setup -- --from <path-to-a-working-checkout>
```

`scripts/setup.sh` (`npm run setup`) is the one-command bootstrap: it checks
`.nvmrc`/docker/the `ai-rules` submodule, fills in gp-api's and gp-webapp's
local `.env`/`.env.local` from `--from` (a teammate's working checkout — real
vendor keys never live in this repo, see `docs/secrets.md`) plus this repo's
own local-only defaults and `.env.example` placeholders, runs `npm ci` and the
Prisma/contracts builds, brings up Postgres, migrates + seeds, and launches
`scripts/dev.sh`, polling until gp-api and gp-webapp are both healthy. It's
idempotent — re-run it any time; it skips whatever's already valid and prompts
before wiping a non-empty local DB. Without `--from` and with no existing env
files, it refuses rather than boot with nothing to work from. election-api and
gp-admin aren't part of it; gp-webapp already defaults to the deployed dev
election-api, and gp-admin isn't part of the stack `scripts/dev.sh` boots.

Once the stack is healthy, it finishes by seeding a login: a QA fixture user
(`packages/gp-api/src/testFixtures/`) in product state `--user-state`
(default `free-win`), minted via a per-run Clerk M2M token and printed once
to the terminal (URL, email, password — never written to a file or log).
This needs `LOCAL_SETUP_CLERK_MACHINE_SECRET` set in `packages/gp-api/.env`
(a dedicated local-setup Clerk machine, vended in the LOCAL_DEV_ENV bundle);
absent, that step just prints a skip note and the run still exits 0.

If you'd rather set up by hand: `nvm use`, `npm install` (runs a `postinstall`
that initializes the `ai-rules` git submodule — if `ls ai-rules/` is empty, run
`git submodule update --init --recursive ai-rules`), then copy each app's
`.env.example` / `.env.local` template before starting it.

## Run the core loop

```bash
npm run dev      # Postgres (gp-api docker compose) + gp-api (:3000) + gp-webapp (:4000)
```

`scripts/dev.sh` boots the most common stack once env files and dependencies
are already in place (`npm run setup` calls it as its own final step). Other
apps start the same way via their workspace name.

## Per-app commands (npm workspaces)

```bash
npm run start:dev -w gp-api          # gp-api on :3000
npm run dev       -w packages/gp-webapp # gp-webapp on :4000
npm run start:dev -w election-api    # :3001
npm run dev       -w gp-admin        # :3500
npm run dev       -w candidate-sites # :4001
```

`npm`'s `-w` resolves either a workspace name or its path; the path form
`-w packages/<dir>` always works and is unambiguous.

gp-api reads voter data from Databricks (`src/peopleDb/`) — set the
`PEOPLE_DATABRICKS_*` vars in gp-api's local env or every contacts and
door-knocking read fails. See `packages/gp-api/src/peopleDb/AGENTS.md`.

## Prisma

Generate clients for both Prisma-managed backends from the root:

```bash
npm run generate:prisma            # gp-api + election-api
npm run generate:prisma:gp-api     # one service
```

gp-api migrations run from inside its workspace (`npm run migrate:dev -w gp-api`).
See `packages/gp-api/prisma/AGENTS.md`.

## Per-app detail

Before deep work in an app, read its `AGENTS.md` (commands, patterns, gotchas):
`packages/gp-api/AGENTS.md`, `packages/gp-webapp/AGENTS.md`, and the nested ones in
feature folders.
