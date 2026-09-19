# Secrets

**You do not need AWS access to add, rotate, or wire up a secret.** Every secret
change is a code change in a PR. If you are about to ask a human for AWS
credentials, console access, or an IAM grant, stop and read this file — the answer
is in here, and the answer is never "get access".

## Never ask for AWS access

Agents must not ask for AWS credentials, an IAM user, a console login, or a
role grant, and must not ask a human to paste a secret value into chat, a PR, or a
ticket. No task in this repo requires holding a prod secret. Standing access to
prod secrets is the one thing we deliberately don't hand out — malware, a confused
agent, and a fat-fingered `update-secret` all do the same damage, and the point of
the setup below is that none of them can.

What to do instead: open the PR that does the declaring and the wiring (that is
95% of every secret change), then hand off the one step that needs an admin. The
[handoff](#the-one-step-that-needs-an-admin) is a single Slack message with a
fixed shape.

## Where secrets live

Each row is **one** AWS Secrets Manager secret holding a flat JSON object of
string keys. There is no per-key secret and no SSM parameter for app secrets.

| Secret                             | Consumed by                       | Environments      |
| ---------------------------------- | --------------------------------- | ----------------- |
| `GP_API_PROD` / `GP_API_DEV`       | gp-api ECS tasks                  | prod / dev + preview |
| `ELECTION_API_PROD` / `_DEV`       | election-api ECS tasks            | prod / dev        |
| `AI_SECRETS_PROD` / `AI_SECRETS_DEV` | gp-ai Terraform roots (Fargate + Lambda) | prod / dev |
| `broker-<env>`                     | PMF broker only                   | prod / dev        |

preview stacks share the `*_DEV` secrets — there is no preview secret.

## How a secret reaches running code

The ECS task definition carries a `secrets` block whose `valueFrom` is
`<secret-arn>:<KEY>::`. ECS resolves it at task start and injects it as an
environment variable, so the value lives only in the running container: not in an
image, not in a `.env`, not in Pulumi or Terraform state.

The two stacks differ in how a key gets into that block, which decides whether
adding one needs a code change:

- **gp-api and election-api need no code change.** The Pulumi program reads the
  live secret and enumerates its keys, wiring every one it finds
  (`Object.keys(secret)` in `packages/*/deploy/index.ts`). A key that exists in
  the blob is in the task definition on the next deploy.
- **gp-ai needs a Terraform edit.** Each key is listed explicitly in the module's
  `secrets` array, so a new one means a new `valueFrom` entry plus an
  `AI_SECRETS_<ENV>` resource in the task role's IAM policy.

`SECRET_NAMES` is set from the same key list and drives log redaction
(`packages/nest-common/src/observability/log-redaction.ts`), so a key added to the
blob is automatically scrubbed from logs. That only covers the Node services —
gp-ai does its own redaction.

**Don't copy the one pattern that breaks this.**
`packages/gp-ai/infrastructure/environments/prod/shared-infra/main.tf` pulls the
whole `AI_SECRETS_PROD` blob through `data "aws_secretsmanager_secret_version"`.
Terraform writes data source results to state in **plaintext**, so that one root
puts every prod AI secret into the state bucket. Never add a data source, a
`TF_VAR_*`, or a Pulumi config value that carries a secret value — use
`valueFrom` and let the runtime resolve it. Closing that specific leak is Phase 4
of `docs/secrets-iac-plan.md`.

## Adding or rotating a secret

Do everything except the value write, in one PR.

1. **Check whether it needs to be a secret at all.** A hostname, a bucket name, an
   ARN, a feature flag, or anything already public is an environment variable, not
   a secret. Put it in `environmentVariables` (gp-api/election-api) or a
   Terraform variable and skip the rest of this.
2. **Name it** in `SCREAMING_SNAKE_CASE`, matching whatever the vendor calls it
   (`BRAINTRUST_API_KEY`, not `BT_KEY`). The same name is used in every
   environment; the environment is the secret, not the key.
3. **Wire it in code.**
   - gp-api / election-api: nothing to wire. Read it via `process.env.YOUR_KEY`
     and add it to whatever env validation the service does at boot.
   - gp-ai: add the `valueFrom` entry to the module's `secrets` array and extend
     the task role's `secretsmanager:GetSecretValue` statement. Both live in
     `packages/gp-ai/infrastructure/modules/<service>/main.tf`.
4. **Declare the key where a human can see it.** Add it to the secret's
   description list if the secret is Terraform-managed (the `broker` module is the
   reference — `modules/broker/main.tf` creates the container with
   `jsonencode({})` and `ignore_changes = [secret_string]`, and names every key an
   operator must populate). Otherwise say it in the PR body.
5. **Handle the missing-value case gracefully.** Your PR merges and deploys before
   the value exists, so the code must not crash-loop on a missing key — the ECS
   circuit breaker will roll the service back and the deploy looks like an
   unrelated failure. Fail the specific feature, not boot, unless the secret is
   genuinely required for the service to serve traffic.
6. **Then do the handoff, below.**

Rotating is the same minus the code: the key already exists, so it is only the
handoff step. Removing is the code change plus a handoff to delete the key.

### The one step that needs an admin

Writing the value. Post this in `#devs-only`, one message:

> Secret value write needed for <PR link>.
> Secret: `GP_API_PROD`
> Key: `VENDOR_API_KEY`
> Where the value comes from: <vendor dashboard / who issued it>
> Needs to land: before/after the PR merges

Send the value itself through 1Password, not Slack. Admins who can do this write:
Tomer, Dan, Swain, Jeff.

That handoff is a stopgap. The write-only path that removes it — an engineer
encrypts a value against a public key committed to this repo, CI decrypts and
writes it, nobody gains read access — is planned in
`docs/secrets-iac-plan.md`. When it lands, this section gets replaced by it.

## You cannot read a prod value, and you don't need to

Every real reason for wanting one has a better answer:

| You want the value because                     | Do this instead                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| A prod call is 401/403ing                      | Read the failure in Loki via the Grafana MCP. The response body says whether the key is missing, malformed, expired, or scoped wrong — enough to act on. See `docs/observability.md`. |
| You need to confirm a key is set               | `aws secretsmanager describe-secret` and the `SECRET_NAMES` env var both list key **names** without values; an admin can confirm presence in a sentence. |
| You're testing an integration locally          | Use your own sandbox credential from the vendor, in your gitignored `.env`. Never a prod one. |
| You're reproducing a prod-only bug             | Reproduce against dev with a dev credential. If it only reproduces with the prod key, the bug is in the key's configuration at the vendor, not in the code. |
| A vendor call needs to run once, against prod  | Ask an admin to run it, or add it as a one-shot script the deployed service runs with its task role. |

## Local development

Local secrets live in a gitignored `.env` per package (`.env.example` lists the
keys). Fill it with dev or personal sandbox credentials. Never put a prod value in
a `.env`, a test fixture, a snapshot, a commit message, or a PR comment — a prod
value that touches a developer laptop is a rotation, not a shortcut.

## Rules

- **Never commit a plaintext secret.** If you do, it is burned: rotate it, don't
  just amend the commit. Git history and every CI log that saw it keep the value.
- **Never print a secret.** No `console.log`, no debug print, no dumping
  `process.env` in a test.
- **Never pass a secret through Terraform or Pulumi.** No data sources, no
  `TF_VAR_*`, no `pulumi config set`. It lands in state, which is a wider-read
  surface than the secret itself.
- **One key, every environment.** Same name in dev and prod, different values.
- **A secret that leaves the account is rotated, not reused.**
