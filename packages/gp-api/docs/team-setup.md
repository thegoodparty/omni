# Team Development Setup

Setup is `npm run setup` from the repo root — see root `docs/development.md`.
This page keeps the gp-api environment-consistency notes that survive it:
IDE configuration and the Node/npm troubleshooting table.

## Required Node.js Version

This project requires the Node.js version in `.nvmrc` (currently **22.12.0**)
to ensure consistency between local development and Docker production
environments. `scripts/setup.sh` checks it in preflight; `package.json`
`engines` and the Docker base image enforce the same version elsewhere.

## IDE Configuration

**VS Code:**
Add to your `.vscode/settings.json`:

```json
{
  "typescript.preferences.importModuleSpecifier": "relative",
  "eslint.workingDirectories": ["./"],
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  }
}
```

## Troubleshooting

### Issue: "Node version mismatch"

```bash
# Solution: Use the correct Node version
nvm use
```

### Issue: "npm ci fails in Docker"

```bash
# This usually means package-lock.json was generated with the wrong Node
# version or has peer dependency conflicts.
# Solution: Regenerate with the correct version (legacy peer deps is set
# in .npmrc, so plain npm install applies it)
nvm use
rm package-lock.json
npm install
```

### Issue: "Different dependency versions between developers"

```bash
# Solution: Use npm ci instead of npm install
npm ci  # Uses exact versions from package-lock.json
```
