# secrets/

Encrypted secret values, committed on purpose. Only CI can decrypt them, so
adding one here needs no AWS access and gives you no way to read an existing one.

Do not hand-edit these files — see `AGENTS.md` in this directory for the command,
or `docs/secrets.md` for the full workflow.
