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

### Testing

This project uses [Playwright](https://playwright.dev/) for end-to-end testing.

#### Running E2E Tests

**Option 1: Let Playwright manage the server (simplest)**

```bash
npm run test:e2e
```

Playwright will automatically start the dev server with E2E testing enabled.

**Option 2: Use your own dev server**

If you want to run tests against an existing dev server (faster iteration):

```bash
# Terminal 1: Start dev server with E2E testing enabled
npm run dev:test

# Terminal 2: Run tests
npm run test:e2e
```

> **Note:** You must use `npm run dev:test` (not `npm run dev`) to enable the authentication bypass for tests.

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
- Tests run against chromium, firefox, and webkit browsers
- The dev server starts automatically when running tests (unless already running)

#### CI/CD

E2E tests run automatically on Vercel preview deployments. The workflow:

1. Vercel deploys a preview
2. GitHub Actions runs Playwright tests against the preview URL
3. Results are posted as a comment on the PR

**Required Vercel Environment Variable (Preview only):**

- `NEXT_PUBLIC_E2E_TESTING=true`

### Useful Commands

- `npm run dev` - Start all apps in development mode
- `npm run dev:test` - Start web app in e2e testing mode
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

- **E2E Testing**: Playwright (chromium, firefox, webkit)

### Monorepo

- **Build System**: Turborepo
- **Package Manager**: npm workspaces
