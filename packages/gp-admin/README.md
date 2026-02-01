![GP Admin](https://assets.goodparty.org/gp-admin.png)

# GP Admin

A Turborepo monorepo with Next.js frontend and NestJS backend.

## What's inside?

This Turborepo includes the following packages/apps:

### Apps

- `web`: a [Next.js](https://nextjs.org/) 16 app with Tailwind CSS
- `api`: a [NestJS](https://nestjs.com/) 11 application

### Packages

- `@gp-admin/typescript-config`: shared `tsconfig.json`s used throughout the monorepo
- `@gp-admin/eslint-config`: shared ESLint configurations

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

To develop all apps and packages, run:

```bash
npm run dev
```

This will start:

- Next.js app on [http://localhost:3500](http://localhost:3500)
- NestJS API on [http://localhost:3501](http://localhost:3501)

### Build

To build all apps and packages:

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

This project uses [Playwright](https://playwright.dev/) for end-to-end testing.

#### Running E2E Tests

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

See `env.example` for the full list of test user variables.

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

Test user credentials for each role and organization. See `env.example` for the full list.

### Useful Commands

- `npm run dev` - Start all apps in development mode
- `npm run build` - Build all apps and packages
- `npm run lint` - Lint all apps and packages
- `npm run format` - Format all files with Prettier
- `npm run clean` - Clean all build artifacts and node_modules
- `npm run test:e2e` - Run Playwright e2e tests
- `npm run test:e2e:ui` - Run e2e tests with interactive UI
- `npm run test:e2e:headed` - Run e2e tests in headed browser mode
- `npm run test:e2e:report` - View HTML test report

## Tech Stack

### Frontend (Next.js)

- **Framework**: Next.js 16 with App Router
- **Styling**: Tailwind CSS
- **Language**: TypeScript

### Backend (NestJS)

- **Framework**: NestJS 11
- **Language**: TypeScript
- **Testing**: Jest

### Testing

- **E2E Testing**: Playwright (chromium)

### Monorepo

- **Build System**: Turborepo
- **Package Manager**: npm workspaces
