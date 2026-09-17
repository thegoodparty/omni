# secrets/

Encrypted secret values, committed on purpose.

Each `<service>.<dev|prod>.json` holds one ciphertext per key, encrypted against
the public key in this directory. Only CI can decrypt them, so adding a secret
here needs no AWS access and gives you no way to read an existing one.

**Do not hand-edit these files.** Use the tooling, which encrypts from stdin so
the value never lands in your shell history or in `ps` output:

```bash
printf %s "$VALUE" | scripts/secrets/secret-encrypt.sh secrets/gp-api.prod.json VENDOR_API_KEY
```

Only `<service>.<env>.json`, `gp-secret-write.pub.pem`, and this README belong in
here — CI rejects anything else, because a `.env` or a scratch file in this
directory is how a plaintext secret gets committed.

Full workflow: `docs/secrets.md`. Design and rationale:
`docs/secrets-iac-plan.md`.
