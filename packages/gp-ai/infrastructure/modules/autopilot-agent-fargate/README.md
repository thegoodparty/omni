# autopilot-agent-fargate

RunTask-only Fargate infra for the autopilot stage runner (`autopilot/`, this
package). No `aws_ecs_service` — see `main.tf`'s header comment for why. Two
task definitions, `autopilot-agent` (base) and `autopilot-agent-playwright`
(qa stage only), both built from the one `autopilot/Dockerfile`.

## The warm image (ENG-11149)

Both variants share a baked layer: a full omni checkout plus its `npm ci`'d
`node_modules`, copied in from the CI checkout that builds the image rather
than cloned again over the network (`autopilot/Dockerfile`'s "Warm-image
bake" step, `BAKED_OMNI_DIR=/opt/omni-bake`). At container start,
`agent/workspace.py`'s `prepare_omni_workspace` turns what used to be a fresh
`git clone` + a model-driven `npm ci`/build/Prisma pass (5-10 min of paid
agent time per run, and the proximate cause of the ENOSPC incident behind
this module's 60 GiB `ephemeral_storage`, PR #1989) into a `git fetch` +
`git reset --hard origin/main` — seconds, and never billed against the run's
budget. `npm ci` only re-runs when the fetched `package-lock.json` no longer
matches the hash recorded at bake time.

**Build time and size.** The bake adds a full `npm ci` (root + every
workspace member) to every autopilot image build — several minutes, and
several GB of `node_modules` on top of the already-large base image (Node,
the Claude CLI, Playwright's Chromium on the `-playwright` variant). That
trade is deliberate: it moves cost from "every stage run, paid" (npm ci is
now the *rare* runtime path, taken only on a lockfile change) to "every image
build, unpaid" (main-push image builds), and to a slower ECR pull the first
time an ECS task lands on a fresh Fargate instance (subsequent tasks on
warm instances reuse cached layers).

**Verifying no credential lands in a layer.** The bake runs `npm ci
--ignore-scripts` specifically so no postinstall/prepare script — this
repo's own or a transitive dependency's — can read or leak anything the
build environment sees; the deferred lifecycle (ai-rules submodule init,
workspace-internal builds, Prisma generation) runs at container start
instead, where each run's own real env is in scope and there is no image
layer for it to end up in. The build itself is also never handed a secret to
begin with (no build-arg, no mounted secret) — nothing bakes credentials in
by omission or by design. To spot-check a built image directly:

```bash
docker history --no-trunc <image> | grep -i -E 'token|secret|key|password'
```

An empty result is expected; anything else is a defect in the bake, not an
artifact of how autopilot normally runs (its GitHub auth is a per-run,
short-lived App installation token minted at container start, never at
build time — see `agent/github_auth.py`).
