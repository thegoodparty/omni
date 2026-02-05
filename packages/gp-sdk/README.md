# @goodparty_org/sdk

TypeScript SDK for interacting with the GoodParty API.

## Installation

```bash
npm install @goodparty_org/sdk
```

## Usage

```typescript
import { GoodPartyClient } from '@goodparty_org/sdk'

const client = new GoodPartyClient()
```

## Development

### Prerequisites

- Node.js 22.12.0 (use `.nvmrc` with nvm)

### Setup

```bash
npm install
```

### Scripts

| Command              | Description                          |
| -------------------- | ------------------------------------ |
| `npm run build`      | Build the SDK with tsup              |
| `npm run typecheck`  | Run TypeScript type checking         |
| `npm run lint`       | Run ESLint                           |
| `npm run lint:fix`   | Run ESLint with auto-fix             |
| `npm run format`     | Format code with Prettier            |
| `npm run format:check` | Check code formatting              |

### Publishing

The SDK is automatically published to npm when changes are merged to `master`:

1. Bump the version in `package.json`
2. Create a pull request
3. After merge, CI will create a GitHub Release and publish to npm

## License

See [LICENSE](LICENSE) for details.
