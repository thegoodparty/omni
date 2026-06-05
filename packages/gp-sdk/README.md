# @goodparty_org/sdk

TypeScript SDK for interacting with the GoodParty API.

## Installation

```bash
npm install @goodparty_org/sdk
```

## Usage

```typescript
import { GoodPartyClient, SdkError } from '@goodparty_org/sdk'

const client = await GoodPartyClient.create({
  m2mSecret: process.env.GP_MACHINE_SECRET,
  gpApiRootUrl: 'https://gp-api.goodparty.org/v1',
})

// Users
const user = await client.users.get(1)

const users = await client.users.list({ offset: 0, limit: 20 })

const filtered = await client.users.list({
  firstName: 'John',
  sortBy: 'createdAt',
  sortOrder: 'desc',
})

const updatedUser = await client.users.update(1, {
  firstName: 'Jane',
  roles: ['candidate'],
  metaData: { hubspotId: 'abc123', textNotifications: true },
})

await client.users.updatePassword(1, {
  oldPassword: 'old',
  newPassword: 'new',
})

await client.users.delete(1)

const campaign = await client.campaigns.get(1)

const campaigns = await client.campaigns.list({ offset: 0, limit: 20 })

const byUser = await client.campaigns.list({
  userId: 42,
  sortBy: 'createdAt',
  sortOrder: 'desc',
})

const updatedCampaign = await client.campaigns.update(1, {
  isActive: true,
  details: { office: 'Mayor' },
})

const offices = await client.electedOffices.list({
  userId: 42,
  offset: 0,
  limit: 20,
})

const office = await client.electedOffices.get('some-uuid')

const updatedOffice = await client.electedOffices.update('some-uuid', {
  electedDate: '2026-01-15',
  isActive: true,
})

const officeWithDistrict = await client.electedOffices.updateDistrict(
  'some-uuid',
  {
    state: 'CA',
    L2DistrictType: 'CITY',
    L2DistrictName: 'OAKLAND',
  },
)

// Organizations (admin / M2M)
const org = await client.organizations.get('campaign-123')

const orgs = await client.organizations.list({ email: 'owner@example.com' })

const patched = await client.organizations.patch('campaign-123', {
  customPositionName: 'Mayor',
  overrideDistrictId: 'district-uuid',
})

// Ecanvasser
const ecanvasser = await client.ecanvasser.create({
  apiKey: 'ecanvasser-api-key',
  email: 'user@example.com',
})

const allEcanvassers = await client.ecanvasser.list()

await client.ecanvasser.syncAll()

await client.ecanvasser.delete(campaignId)

// Admin agent runs (admin / M2M)
const runs = await client.adminAgentRuns.list({
  experimentType: 'compliance_setup',
  status: 'COMPLETED',
  offset: 0,
  limit: 20,
})

const runDetail = await client.adminAgentRuns.get('run-uuid')

const retriedRun = await client.adminAgentRuns.retry('run-uuid')

// Admin briefings (admin / M2M)
const briefings = await client.admin.briefings.list({
  q: 'mayor',
  dateRange: 'last 30 days',
  offset: 0,
  limit: 20,
})

const briefing = await client.admin.briefings.get('briefing-uuid')

client.destroy()
```

The `destroy()` method cleans up internal token renewal timers. Call it when you are done using the client to prevent leaked timers.

All methods throw `SdkError` on failure:

```typescript
try {
  const user = await client.users.get(999)
} catch (error) {
  if (error instanceof SdkError) {
    console.error(error.status, error.message)
  }
}
```

## Development

### Prerequisites

- Node.js 24.13.0 (use `.nvmrc` with nvm: `nvm install && nvm use`)

### Setup

```bash
npm install
```

### Scripts

| Command                | Description                       |
| ---------------------- | --------------------------------- |
| `npm run dev`          | Build in watch mode for local dev |
| `npm run build`        | Build the SDK with tsup           |
| `npm run typecheck`    | Run TypeScript type checking      |
| `npm run lint`         | Run ESLint                        |
| `npm run lint:fix`     | Run ESLint with auto-fix          |
| `npm run format`       | Format code with Prettier         |
| `npm run format:check` | Check code formatting             |

### Publishing

This package uses [changesets](https://github.com/changesets/changesets) for versioning. **Don't bump `package.json` manually.**

1. Run `npx changeset add` and describe the change (`patch` / `minor` / `major`). Commit the generated `.changeset/*.md` file with the rest of your PR.
2. Open a PR to `master`. CI runs `typecheck → lint → format:check → build`.
3. After merge, the publish workflow opens (and auto-merges) a release PR that bumps versions and updates `CHANGELOG.md`. The next workflow run publishes to npm and creates a `v<version>` GitHub Release with auto-generated notes.

See [`docs/getting-started.md`](https://github.com/thegoodparty/gp-sdk/blob/master/docs/getting-started.md) for the full release flow + local-development tips (link / file: protocol).

## License

See [LICENSE](LICENSE) for details.
