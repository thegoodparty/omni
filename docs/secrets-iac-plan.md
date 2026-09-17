# Plan: write-only secret provisioning

**Status:** proposed, not built. `docs/secrets.md` describes what works today.

**Goal.** An engineer or agent can add, rotate, or delete any secret in any
environment through a reviewed PR, holding no AWS credentials and gaining no
ability to read any existing secret value.

**Non-goal.** Giving anyone read access to prod secrets. This plan removes the
reason to want it, which is the only durable way to keep the answer "no".

Delete this file when Phase 5 lands.

## Why the obvious approaches don't work

Worth writing down, because each of these looks like the answer for about an hour.

- **`TF_VAR_*` / tfvars / `pulumi config set`.** Plaintext in state, and state is
  a wider-read surface than the secret. This is the bug Phase 4 fixes, not a
  pattern to build on.
- **SOPS.** The standard choice, and it fails the core requirement: `sops edit`
  decrypts the file's data key to re-encrypt it, so anyone who can add a key can
  read every key in that file. SOPS gives you an audit trail, not write-only
  access.
- **GitHub Environment secrets.** Relocates the trusted human from four AWS
  admins to the GitHub admins, adds a second unmanaged secret store, and gives no
  git history of which key was declared when. Fine as a fallback for a value CI
  itself needs; not the answer for app secrets.
- **Terraform-managed secret versions.** Terraform can own the container but not
  the value: `aws_secretsmanager_secret_version` with a real value puts the
  plaintext in state. The existing `broker` module has this right already — empty
  `jsonencode({})` plus `ignore_changes = [secret_string]`.

## Design

Asymmetric envelope encryption. The engineer encrypts against a **public** key
committed to this repo; only CI holds the private half. Nothing about adding a
secret requires an AWS call, so an agent with no credentials can do the whole
thing.

**KMS key.** One key, `alias/gp-secret-write`, `KeyUsage=ENCRYPT_DECRYPT`,
`KeySpec=RSA_4096`, algorithm `RSAES_OAEP_SHA_256`. Its public key is committed at
`secrets/gp-secret-write.pub.pem` — public by definition, safe in git, and the
thing that makes this credential-free.

**Files.** One per secret per environment, e.g. `secrets/gp-api.prod.yaml`. Each
entry is one independently encrypted, base64 ciphertext keyed by secret name:

```yaml
VENDOR_API_KEY: BASE64_CIPHERTEXT
OTHER_KEY: BASE64_CIPHERTEXT
```

Per-entry encryption (rather than one encrypted document) is what makes it
write-only: adding `VENDOR_API_KEY` never requires decrypting `OTHER_KEY`.

**Encrypting, with no AWS access:**

```bash
printf %s "$VALUE" | openssl pkeyutl -encrypt -pubin \
  -inkey secrets/gp-secret-write.pub.pem \
  -pkeyopt rsa_padding_mode:oaep \
  -pkeyopt rsa_oaep_md:sha256 \
  -pkeyopt rsa_mgf1_md:sha256 | base64
```

**The 446-byte ceiling.** RSA-4096 with OAEP-SHA-256 holds 446 bytes
(512 − 2·32 − 2). API keys and tokens fit; a PEM private key or a cert does not —
`GITHUB_APP_PRIVATE_KEY` in `AI_SECRETS_PROD` is already over it. Those go through
`scripts/secret-encrypt.sh`, which does AES-256-GCM on the value and RSA-wraps the
data key, emitting a tagged `env:` entry the sync step recognizes. Still
openssl-only. Build the script in Phase 1 even if nothing needs it yet, so the
first long value isn't a design decision under time pressure.

**The write happens outside Terraform and Pulumi.** `ci-sync-secrets.sh` decrypts
with `aws kms decrypt` and calls `PutSecretValue` directly. This is the load-bearing
choice: routing it through IaC would put every plaintext back into state and
recreate the problem the plan exists to solve. IaC keeps owning the secret
container, the IAM, and (for gp-ai) which keys are wired.

**A dedicated role.** `github-actions-secrets-sync`, trusted by this repo's OIDC,
holding only `kms:Decrypt` on the one key and
`PutSecretValue`/`GetSecretValue`/`DescribeSecret` on the four named secrets. The
broad `github-actions-pulumi-deploy` role gets no `kms:Decrypt`, so a compromised
Terraform apply can't read the ciphertexts.

### Ordering in the release train

Sync must run **before** the service deploys in each stage. gp-api and
election-api enumerate the live secret's keys at deploy time, so a brand-new key
written after the Pulumi step lands in the blob but isn't in the task definition
until the *next* train — a confusing half-deployed state.

```
dev stage:  sync-secrets(dev)  → service deploys → E2E
prod stage: sync-secrets(prod) → service deploys
```

Sync is idempotent and safe to run when nothing changed, so it can be an
unconditional first step of each stage rather than a path-filtered one.

### Merge and idempotency semantics

- **Read-modify-write**, since one blob holds many keys: read the current secret,
  overlay the declared entries, write back. Never construct the blob from the
  file alone.
- **A live key not present in the file is left alone and reported.** Implicit
  pruning plus a partially migrated file equals wiping prod credentials. Deletion
  is an explicit, separate action (a `--prune` run an admin triggers, or a
  tombstone entry — decide in Phase 3, when there's a real deletion to do).
- **Compare decrypted plaintext against the live value before writing.** OAEP is
  randomized, so re-encrypting an unchanged value produces a different ciphertext;
  the file diff cannot tell you whether a value actually changed. Without the
  plaintext comparison every train cuts a new secret version for every key
  forever.

### Guardrails

- **PR-time validation does no decryption.** It checks that each entry is valid
  base64 and that the ciphertext is exactly 512 bytes for RSA-4096 (or a
  well-formed `env:` envelope). That catches the realistic mistakes — a truncated
  paste, a value encrypted to the wrong key, a plaintext committed by accident —
  with zero AWS access at PR time, so there is no decrypt path a malicious PR can
  turn into an exfiltration path.
- **Block plaintext.** A pre-commit hook plus a CI job that rejects any file under
  `secrets/` whose entries aren't recognized ciphertext. `lint-staged.config.js`
  currently skips YAML, so this needs its own entry.
- **Audit.** Git shows who declared which key and when; CloudTrail shows every
  `PutSecretValue` by the sync role. Neither records values.

## Phases

| Phase | What | Effort | Unblocks |
| ----- | ---- | ------ | -------- |
| 0 | Ship `docs/secrets.md`. Extend the `broker` pattern to the other Terraform-managed secrets so the container and key list are declared in code. No new tech. | 0.5d | Agents stop asking for access; the ask shrinks to one value write |
| 1 | KMS key + committed public key + `scripts/secret-encrypt.sh` + PR-time structural validation + plaintext guard. Nothing consumes the files yet. | 1d | Engineers can produce ciphertext and get it reviewed |
| 2 | `github-actions-secrets-sync` role + `ci-sync-secrets.sh` + wire into the train's **dev** stage. Migrate 2–3 real dev keys end to end. | 1–2d | Self-service dev secrets |
| 3 | Enable the prod stage. Migrate the existing prod blobs' keys into declared files. Settle the deletion mechanism. | 1d | Self-service prod secrets — the actual goal |
| 4 | Close the state leak: drop the `AI_SECRETS_PROD` data source from `prod/shared-infra`, **rotate every key it exposed**, and revoke `GetSecretValue` from the deploy role where it's now unused. | 1d | The policy stops being undermined by its own tooling |
| 5 | Replace `docs/secrets.md` §"Adding or rotating a secret" with the new flow; delete this file. | 0.5d | — |

Roughly a week of focused work, and Phase 0 alone removes most of the day-to-day
friction. Phases 0 and 1 are independent and can land in either order.

Phase 4 needs the rotation, not just the code change: the state bucket has
versioning enabled, so removing the data source leaves the plaintext in every
historical state object. Deleting those versions is an alternative, but rotating
is cheaper to verify than proving an S3 version purge was complete.

## One-time manual steps (need an admin)

The deploy role's IAM policy isn't in IaC, so the bootstrap can't be
self-service. Each is a few minutes:

1. Create the KMS key and `alias/gp-secret-write`, with a key policy granting
   `kms:Decrypt` only to `github-actions-secrets-sync`.
2. Export the public key (`aws kms get-public-key`) for the PR that commits it.
3. Create `github-actions-secrets-sync` with the OIDC trust policy and the
   least-privilege policy above.
4. Set `vars.AWS_SECRETS_SYNC_ROLE_ARN`.
5. Add a `CODEOWNERS` file (there is none today) requiring admin review on
   `secrets/**`, so prod secret PRs keep a human gate.

## Open questions

- **Do engineers keep dev read/write?** Several docs assume they can run
  `get-secret-value` against `AI_SECRETS_DEV` (see
  `packages/gp-ai/shared/docs/braintrust.md`). Recommend yes, unchanged — dev
  values are rotatable and low-consequence, and the friction this plan removes is
  about prod.
- **Who approves a prod secret PR?** Recommend a required review from the admin
  group via `CODEOWNERS`. Jeff keeps the review gate he's asking for; what goes
  away is the admin doing the mechanical work.
- **Who can read the two state buckets** (`goodparty-terraform-state-us-west-2`,
  `goodparty-iac-state`) today? This determines how urgent Phase 4 is and whether
  the current "no prod secret access" posture is real.
- **Rotation policy** — cadence, and who owns noticing an expiring credential.
  Out of scope here, but this plan makes rotation cheap enough to have a policy.
