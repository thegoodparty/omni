# Local development

## First-time setup

```bash
git clone --recurse-submodules git@github.com:thegoodparty/omni.git
cd omni
npm run setup
```

`scripts/setup.sh` (`npm run setup`) is the one-command bootstrap: it checks
`.nvmrc`/docker/the `ai-rules` submodule, fills in gp-api's and gp-webapp's
local `.env`/`.env.local` — by default via the GitHub device flow (authorize
in the browser as any active `thegoodparty` org member; dev-grade values are
vended by dev gp-api, real vendor keys never live in this repo, see
`docs/secrets.md`), or from `--from <path-to-a-working-checkout>` (a
teammate's checkout, kept as the escape hatch and taking precedence when
given) — plus this repo's own local-only defaults and `.env.example`
placeholders, runs `npm ci` and the Prisma/contracts builds, brings up
Postgres, migrates + seeds, and launches `scripts/dev.sh`, polling until
gp-api and gp-webapp are both healthy. It's idempotent — re-run it any time;
it skips whatever's already valid and prompts before wiping a non-empty local
DB. When the device flow is denied or unavailable and no `--from` or existing
env files exist, it fails closed rather than boot with nothing to work from.
When a `degradable` var that declares a `placeholder` in its env contract
(e.g. `ANTHROPIC_API_KEY` for AI chat) is still at that placeholder, the env
step names the feature that will stay off; the fix is adding the key to
`LOCAL_DEV_ENV`, not editing `.env` by hand. A re-run skips a `.env` that
already validates, so a key added to `LOCAL_DEV_ENV` after your first run
only reaches you with `npm run setup -- --secrets-only --refresh`, which
fetches the bundle again and lays it over your files, keeping every value
the bundle doesn't carry. The same fetch writes the Grafana MCP token to
`.env.mcp.local` at the repo root, so your agent can read logs
(`docs/mcp.md`); restart Claude Code after it lands.
election-api and
gp-admin aren't part of it; gp-webapp already defaults to the deployed dev
election-api, and gp-admin isn't part of the stack `scripts/dev.sh` boots.

gp-api reads election data (races, positions, districts, office holders) from
a second database. Locally that is `electiondb` in the same Postgres
container, loaded from a seed of Michigan, North Carolina and Wyoming taken
from the dev election database. Setup fetches the seed on the same GitHub
sign-in as the env bundle and loads it after the gp-api migrate step, so
zips in those three states return races and the test fixtures' default race
(zip 82001, Cheyenne City Council Ward 1) resolves. Anywhere else returns no
races locally. A run that skipped the sign-in (env files already valid, or
`--from`) has no seed yet; fetch and load one with `npm run seed:election`.
The seed is restricted data, so it lives in a private dev bucket and is
never committed; how it is built and refreshed is in
`packages/gp-api/src/electionDb/AGENTS.md`.

A local stack can't run agent experiments (community issues, briefings,
opponent research, compliance setup). A run's result comes back on dev's
shared results queue to dev gp-api, so no `LOCAL_DEV_ENV` key or AWS
credential fixes it. Seed the data locally (community issues have
`POST /v1/community-issues/seed`) and test real runs on dev. Dev doesn't
dispatch anything gated by `MEETINGS_AUTOMATION_ENABLED` on its own, because
that flag is prod-only. Previews can't run agent experiments at all. See
`packages/gp-api/src/communityIssues/AGENTS.md`.

Once the stack is healthy, it finishes by seeding a login: a QA fixture user
(`packages/gp-api/src/testFixtures/`) in product state `--user-state`
(default `free-win`), minted via a per-run Clerk M2M token and printed once
to the terminal (URL, email, password — never written to a file or log).
This needs `LOCAL_SETUP_CLERK_MACHINE_SECRET` set in `packages/gp-api/.env`
(a dedicated local-setup Clerk machine, vended in the LOCAL_DEV_ENV bundle);
absent, that step just prints a skip note and the run still exits 0. Secret
mechanics (what `LOCAL_DEV_ENV` is, what it's allowed to vend, and the
two-place rotation rule) are in `docs/secrets.md`.

That login starts empty. To test the CRM, the effort reports or feedback
synthesis against a lived-in account, seed one with the stack running:

```bash
npm run seed:activity -- --fixture serve       # or pro-win / serve-won-race
npm run seed:activity -- --org <organization-slug>
```

`--fixture` mints a fresh fixture user that already has activity and prints
its login. `--org` fills an org already in your local database, such as one
you onboarded by hand. Either way the org gets a door-knocking turf, a phone
list, a text send and a robocall against real voters from its district, a
few hundred memos on the answered doors and calls, and a synthesis run per
effort. It takes a minute or two, needs working voter data, and uses the same
`LOCAL_SETUP_CLERK_MACHINE_SECRET` as the login step. Details are in
`packages/gp-api/src/testFixtures/AGENTS.md`.

A Serve (`eo-`) org also gets the whole civic panel loop:

- **Civic panel** (`/dashboard/contacts/citizens-panel`): 60 to 100
  members, from door and call yeses plus JOIN replies to a panel invite
  text, and a build plan at 2 hours a week whose first text step reads done.
- **Priority** (`/dashboard/priorities`): "Safer streets near schools", with
  a text ask to panel members and other residents. Every resident asked
  replies and gets a coded answer, so the priority reads as every group
  heard and its results page (`/dashboard/priorities/<id>/results`) opens
  with themes.

Set how the priority reads with `--answers <n>` (how many residents answer,
each with a coded answer) and `--split even` (answers split half yes, half
no, instead of nine in ten yes), on `--org` or `--fixture`:

```bash
npm run seed:activity -- --org <slug> --answers 0     # Waiting to hear back
npm run seed:activity -- --org <slug> --answers 40    # A few groups need more answers
npm run seed:activity -- --org <slug> --split even    # Still unsure what some groups think
```

With no flags every resident asked answers, and the priority reads as Every
group heard. Which counts land on which state depends on how many groups
the district has: the counts above are what a district of about 20 groups
(six age bands, two genders and a dozen neighborhoods) gives, and a district
with fewer groups needs fewer answers. Run it again and it adds another round
of outreach and a second priority; the plan is reused.

The default sample is 250 residents.

If you'd rather set up by hand: `nvm use`, `npm install` (runs a `postinstall`
that initializes the `ai-rules` git submodule — if `ls ai-rules/` is empty, run
`git submodule update --init --recursive ai-rules`), then copy each app's
`.env.example` / `.env.local` template before starting it.

**Fast tier — UI-only work.** If the change doesn't touch gp-api or real data,
skip this whole stack: `npm run dev -w packages/prototypes` boots
`packages/prototypes` on `:4002` with zero env by design (no backend, no DB,
no secrets). Use it for UI/UX iteration and hand off to the full stack only
once the change needs real data or an endpoint.

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
