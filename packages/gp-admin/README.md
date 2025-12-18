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

### Useful Commands

- `npm run dev` - Start all apps in development mode
- `npm run build` - Build all apps and packages
- `npm run lint` - Lint all apps and packages
- `npm run format` - Format all files with Prettier
- `npm run clean` - Clean all build artifacts and node_modules

## Tech Stack

### Frontend (Next.js)

- **Framework**: Next.js 16 with App Router
- **Styling**: Tailwind CSS
- **Language**: TypeScript

### Backend (NestJS)

- **Framework**: NestJS 11
- **Language**: TypeScript
- **Testing**: Jest

### Monorepo

- **Build System**: Turborepo
- **Package Manager**: npm workspaces
