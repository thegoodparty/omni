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

const p2vs = await client.pathsToVictory.list({
  userId: 42,
  offset: 0,
  limit: 20,
})

const p2v = await client.pathsToVictory.get(1)

const updatedP2v = await client.pathsToVictory.update(1, {
  data: { p2vStatus: 'Complete', winNumber: 5000 },
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

- Node.js 22.12.0 (use `.nvmrc` with nvm)

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

The SDK is automatically published to npm when changes are merged to `master`:

1. Bump the version in `package.json`
2. Create a pull request
3. After merge, CI will create a GitHub Release and publish to npm

## License

See [LICENSE](LICENSE) for details.
