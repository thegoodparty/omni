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

// Admin 10DLC internal-testing approval (M2M): marks an internal
// (@goodparty.org) campaign as 10DLC-approved for testing; real sends
// stay blocked because no Peerly identity exists.
await client.campaigns.grantInternalTestingApproval(1)
await client.campaigns.revokeInternalTestingApproval(1)

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
  reviewStatus: 'pending', // filter by review status: 'pending' | 'passed' | 'failed'
  offset: 0,
  limit: 20,
})
// Each row includes a `review` field ({ verdict, failReason, reviewerEmail, reviewedAt } | null)

const briefing = await client.admin.briefings.get('briefing-uuid')

// Meeting briefings dispatch (admin / M2M)
const preview = await client.meetingBriefings.dispatchPreview('office-uuid')

const briefingDispatch = await client.meetingBriefings.dispatch({
  electedOfficeId: 'office-uuid',
  kind: 'briefing', // 'schedule' | 'briefing'
  useImminenceGate: true,
})

// Community issues dispatch (admin / M2M)
const issuesDispatch = await client.communityIssues.dispatch({
  orgSlugs: ['eo-123'],
})

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

### Monorepo Usage

In `omni`, `@goodparty_org/sdk` is an internal workspace package. Consumers use the
local workspace link, so SDK changes should be built and validated in the same PR
as any consuming app changes.

See [`docs/getting-started.md`](docs/getting-started.md) for local-development tips.

## License

See [LICENSE](LICENSE) for details.
