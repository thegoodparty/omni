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

What to do instead: encrypt the value against the repo's committed public key and
commit it. `scripts/secrets/secret-encrypt.sh` needs no credentials and makes no
network call; CI holds the only key that can decrypt. See
[Adding or rotating a secret](#adding-or-rotating-a-secret). If the public key
isn't committed yet, there's a
[slower admin handoff](#the-admin-handoff-fallback) for the interim.

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

One PR, no AWS access. You encrypt the value against the public key committed at
`secrets/gp-secret-write.pub.pem`; the release train decrypts it with a role only
CI can assume and writes it to Secrets Manager. You cannot read back what you or
anyone else wrote.

```bash
# Add or rotate a value. Reads stdin, so the value never reaches your shell
# history or `ps` output. Creates the file if it doesn't exist yet.
printf %s "$VALUE" | scripts/secrets/secret-encrypt.sh \
  --secret-id GP_API_PROD secrets/gp-api.prod.json VENDOR_API_KEY

# Then commit secrets/gp-api.prod.json like any other file.
```

Values over 446 bytes (PEM keys, certs) automatically switch to an envelope
format — that's the RSA-OAEP ceiling, not a policy — and need nothing extra from
you. Exactly one trailing newline is stripped by default, because `echo "$KEY" |`
is the common invocation and a stray `\n` silently breaks API auth; any earlier
newlines are kept, and `--raw` preserves the bytes verbatim.

The secret named by `--secret-id` has to belong to the file's environment — a
`*.dev.json` cannot write `GP_API_PROD`. The dev sync runs before the E2E, so
crossing that line would be a way to change prod without passing the gate.

The value lands in Secrets Manager on the next release train, in the stage that
runs before the services deploy. Rotating is the same command with a new value.
Deleting a key is a separate, explicit step — the sync never prunes, so removing
an entry from the file leaves the live value alone and reports it.

**Prerequisite: the public key must exist.** Until an admin completes the
one-time steps in `docs/secrets-iac-plan.md` (create the KMS key, commit its
public key, create the sync role, set `vars.AWS_SECRETS_SYNC_ROLE_ARN`),
`secret-encrypt.sh` exits with that message and the train's sync stages skip.
In that window, use the [admin handoff](#the-admin-handoff-fallback)
below — but check for the public key first, because the handoff is the slow path.

### What you still have to wire

Encrypting the value does not wire it into a running service:

1. **Check it needs to be a secret at all.** A hostname, bucket name, ARN, or
   feature flag is an environment variable. Put it in `environmentVariables`
   (gp-api/election-api) or a Terraform variable and skip all of this.
2. **Name it** in `SCREAMING_SNAKE_CASE`, matching what the vendor calls it
   (`BRAINTRUST_API_KEY`, not `BT_KEY`). Same name in every environment — the
   environment is the secret, not the key.
3. **gp-ai only:** add the `valueFrom` entry to the module's `secrets` array and
   extend the task role's `secretsmanager:GetSecretValue` statement, both in
   `packages/gp-ai/infrastructure/modules/<service>/main.tf`. gp-api and
   election-api need nothing — they enumerate the live keys.
4. **Handle the value being absent.** Your code may deploy before the value
   exists. Don't crash-loop on a missing key: the ECS circuit breaker will roll
   the service back and the deploy will look like an unrelated failure. Fail the
   specific feature, not boot, unless the service genuinely cannot serve without
   it.

### The admin handoff (fallback)

Only needed while `secrets/gp-secret-write.pub.pem` is missing. Wire everything
as above, open the PR, then post one message in `#devs-only`:

> Secret value write needed for <PR link>.
> Secret: `GP_API_PROD`
> Key: `VENDOR_API_KEY`
> Where the value comes from: <vendor dashboard / who issued it>
> Needs to land: before/after the PR merges

Send the value itself through 1Password, not Slack. Admins who can do this write:
Tomer, Dan, Swain, Jeff.

## Tooling

| Script                                     | What                                                            | Needs AWS?           |
| ------------------------------------------ | --------------------------------------------------------------- | -------------------- |
| `scripts/secrets/secret-encrypt.sh`        | Encrypt a value into a secret file                              | no                   |
| `scripts/secrets/validate-secret-files.sh` | Structural check; runs pre-commit and on every PR                | no                   |
| `scripts/secrets/secret-selftest.sh`       | End-to-end test against a throwaway keypair and a stubbed `aws` | no                   |
| `scripts/secrets/ci-sync-secrets.sh`       | Decrypt and write to Secrets Manager; release train only         | yes — the sync role  |

Validation never decrypts, deliberately: a PR-time job holding `kms:Decrypt`
would be a read path into every secret, and a PR can edit the workflow that runs
it. Checking the ciphertext's shape still catches a committed plaintext, a
truncated paste, a malformed envelope, and a stray file in `secrets/`. A
well-formed ciphertext encrypted to the *wrong* key can only be caught by
decrypting, so it fails on the train instead.

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
