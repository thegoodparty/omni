# Contracts package (`@goodparty_org/contracts`)

Shared Zod schemas and TypeScript types consumed by `gp-api`, `gp-sdk`, and other clients. Source lives in `packages/contracts` as an npm workspace. Builds via `tsup`.

## When you change a contract

1. Edit `packages/contracts/src/...`.
2. From the repo root, build contracts:
   ```bash
   npm run build -w packages/contracts
   ```
3. Update any consumers in the same PR when the public contract changes.

## When you change a Prisma enum

Enums are re-exported from `packages/contracts/src/generated/enums.ts`. After editing a Prisma schema:

```bash
npm run generate:prisma:gp-api
npm run build -w packages/contracts
```

## Local linking against gp-sdk

```bash
npm run build -w packages/contracts
npm run build -w packages/gp-sdk
```

The monorepo links `@goodparty_org/contracts` into `gp-sdk` automatically through npm workspaces.

## Known gap

`CampaignSchema.data`, `details`, and `aiContent` (in `contracts/src/campaigns/Campaign.schema.ts`) are typed as `z.record(z.string(), z.unknown())`. The real shape lives in `gp-api/src/campaigns/schemas/updateCampaign.schema.ts`. Migrating it into contracts is a known refactor — coordinate with `gp-webapp` consumers before doing it.
