![GP Admin](https://assets.goodparty.org/gp-admin.png)

# GP Admin

A Next.js 16 admin application.

## Getting Started

### Prerequisites

- Node.js 18+
- npm 10+

### Installation

Install dependencies:

```bash
npm install
```

### Development

To start the development server:

```bash
npm run dev
```

The app will be available at [http://localhost:3500](http://localhost:3500).

### Build

To build the application:

```bash
npm run build
```

### Authentication & Authorization

This app uses [Clerk](https://clerk.com/) for authentication with **Organizations** enabled.

#### Organizations & Roles

| Organization | Description                   |
| ------------ | ----------------------------- |
| Development  | Dev environment access        |
| QA           | QA environment access         |
| Production   | Production environment access |

| Role      | Key             | Permissions                                          |
| --------- | --------------- | ---------------------------------------------------- |
| Admin     | `org:admin`     | Full access - manage users, settings, invite members |
| Sales     | `org:sales`     | Read/write campaigns, read users                     |
| Read Only | `org:read_only` | View only access                                     |

#### Permissions

| Permission        | Admin | Sales | Read Only |
| ----------------- | ----- | ----- | --------- |
| `read_users`      | ✓     | ✓     | ✓         |
| `write_users`     | ✓     |       |           |
| `read_campaigns`  | ✓     | ✓     | ✓         |
| `write_campaigns` | ✓     | ✓     |           |
| `manage_settings` | ✓     |       |           |
| `manage_invites`  | ✓     |       |           |

### Testing

#### Unit Tests (Vitest)

```bash
npm run test             # Run tests
npm run test:watch       # Watch mode
npm run test:coverage    # Coverage report
```

#### E2E Tests (Playwright)

**Prerequisites:**

Set test user environment variables. The app uses role-based test users per organization:

```bash
# Development environment users
export CLERK_TEST_DEV_ADMIN_EMAIL="your-dev-admin@example.com"
export CLERK_TEST_DEV_ADMIN_PASSWORD="password"
export CLERK_TEST_DEV_SALES_EMAIL="your-dev-sales@example.com"
export CLERK_TEST_DEV_SALES_PASSWORD="password"
export CLERK_TEST_DEV_READONLY_EMAIL="your-dev-readonly@example.com"
export CLERK_TEST_DEV_READONLY_PASSWORD="password"

# Multi-org user (for testing organization switching)
export CLERK_TEST_MULTI_ORG_EMAIL="your-multi-org@example.com"
export CLERK_TEST_MULTI_ORG_PASSWORD="password"
```

See `.env.example` for the full list of test user variables.

**Option 1: Let Playwright manage the server (simplest)**

```bash
npm run test:e2e
```

Playwright will automatically start the dev server.

**Option 2: Use your own dev server**

If you want to run tests against an existing dev server (faster iteration):

```bash
# Terminal 1: Start dev server
npm run dev

# Terminal 2: Run tests
npm run test:e2e
```

#### Other Test Commands

```bash
# Run tests with UI mode (interactive)
npm run test:e2e:ui

# Run tests in headed browser mode
npm run test:e2e:headed

# View the HTML test report
npm run test:e2e:report
```

#### Test Configuration

- Tests are located in the `e2e/` directory
- Playwright config: `playwright.config.ts`
- Tests run against chromium browser
- The dev server starts automatically when running tests (unless already running)

#### CI/CD

E2E tests run automatically on Vercel preview deployments. The workflow:

1. Vercel deploys a preview
2. GitHub Actions runs Playwright tests against the preview URL
3. Results are posted as a comment on the PR

**Required GitHub Secrets:**

Test user credentials for each role and organization. See `.env.example` for the full list.

### Useful Commands

- `npm run dev` - Start development server
- `npm run build` - Build the application
- `npm run start` - Start production server
- `npm run lint` - Lint the codebase
- `npm run format` - Format all files with Prettier
- `npm run clean` - Clean build artifacts and node_modules
- `npm run test` - Run unit tests
- `npm run test:coverage` - Run unit tests with coverage
- `npm run test:e2e` - Run Playwright e2e tests
- `npm run test:e2e:ui` - Run e2e tests with interactive UI
- `npm run test:e2e:headed` - Run e2e tests in headed browser mode
- `npm run test:e2e:report` - View HTML test report

## Tech Stack

- **Framework**: Next.js 16 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: Radix UI
- **Auth**: Clerk
- **Unit Testing**: Vitest + React Testing Library
- **E2E Testing**: Playwright
