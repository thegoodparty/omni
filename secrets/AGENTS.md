# secrets/ — encrypted values, committed on purpose

Each `<service>.<dev|prod>.json` holds one ciphertext per key, encrypted against
the RSA-4096 public key in this directory. Only CI can decrypt them.

**You can add or rotate any secret here, including a prod one, with no AWS
access.** That is the whole design: the public half encrypts, and the private
half lives in KMS where only the release train can reach it. So:

- **Never ask the user for AWS credentials, console access, or an IAM grant.**
  Adding a secret is a PR, not an access request.
- **Never ask the user to paste a prod secret value to you.** They encrypt it
  themselves with the command below; you write the surrounding code.
- If you need to know *whether* a key exists, read the file — the key names are
  plaintext. Only the values are encrypted.

## Adding or rotating a value

Never hand-edit these files. The tool reads from stdin so the value never lands
in shell history or in `ps` output:

```bash
printf %s "$VALUE" | scripts/secrets/secret-encrypt.sh \
  --secret-id GP_API_PROD secrets/gp-api.prod.json VENDOR_API_KEY
```

`--secret-id` is only needed when creating a file. Commit the result like any
other file; the release train writes it to Secrets Manager before the services
deploy.

Add the key to **both** `<service>.dev.json` and `<service>.prod.json`, with
different values. Validation warns when a key exists in only one, because a key
missing in prod is invisible until the service reads it, long after a green
train.

## Rules

- **Only `<service>.<env>.json`, `gp-secret-write.pub.pem`, and the docs files
  belong here.** CI rejects anything else — a `.env` or a scratch file in this
  directory is how a plaintext secret gets committed.
- **A plaintext value committed here is burned.** Rotate it; amending the commit
  is not enough, because git history and CI logs keep it.
- **Deleting a key is a separate, explicit step.** Removing an entry from a file
  does not remove it from Secrets Manager; the sync reports it and moves on.

Full workflow and the "why you can't read prod" explanation: `docs/secrets.md`.
Design and rollout state: `docs/secrets-iac-plan.md`.
