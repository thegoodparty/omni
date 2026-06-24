---
name: new-prototype
description: Scaffold a new prototype in packages/prototypes. Use when the user says "new prototype", "create a prototype", "scaffold a prototype", "make a shell with X tabs", "make a prototype with X and Y screens", or wants a fresh prototype folder generated from a tab list.
---

# Scaffold a new prototype

Prototypes live in `packages/prototypes/app/p/<slug>/`. Each prototype is a
configured `<AppShell>` with a list of tabs; each tab is a screen component that
renders hardcoded content using `@goodparty_org/styleguide` only. This skill
creates one such folder — either fresh from the `example` template or by
duplicating an existing prototype.

## 1. Gather inputs

Ask the user for three things if they have not already provided them:

1. **Name** — a human-readable title (e.g. "Voter Outreach Dashboard"). Derive the
   `slug` by lowercasing and replacing spaces/special chars with hyphens
   (e.g. `voter-outreach-dashboard`). Confirm the slug before writing files.

2. **Description** — one sentence describing what this prototype explores
   (e.g. "Explore a new layout for volunteer scheduling and outreach tracking.").
   This lands in `meta.ts`.

3. **Tab list** — the names of the tabs/screens. For each tab the user names,
   pick a sensible Lucide icon from the approved set below. Confirm the full
   list before writing files.

### Approved icon set (from `@goodparty_org/styleguide`)

Pick the closest semantic match:

| Tab concept         | Icon                                   |
| ------------------- | -------------------------------------- |
| Overview / home     | `LayoutDashboard`                      |
| Contacts / people   | `UsersRound`                           |
| Messages / comms    | `Send`                                 |
| Settings            | `Settings`                             |
| Calendar / schedule | `Calendar`                             |
| Tasks / checklist   | `ListChecks`                           |
| Map / location      | `MapPin`                               |
| Documents / notes   | `FileText`                             |
| Analytics / metrics | `LayoutDashboard`                      |
| Donations / money   | `HandHeart`                            |
| Volunteers          | `UsersRound`                           |
| Campaign            | `Megaphone`                            |
| Issues / policy     | `ClipboardList`                        |
| Profile / user      | `CircleUserRound`                      |
| Globe / website     | `Globe`                                |
| Search              | `Search`                               |
| Notifications       | `Bell` (add if needed via `icons.tsx`) |

All of these are importable directly from `lucide-react` in prototype code
(not gated by `icons.tsx` — that gate applies to `packages/gp-webapp`, not to
`packages/prototypes`).

## 2. Two creation modes

### Mode A: fresh from the `example` template

1. Copy `packages/prototypes/app/p/example/` to
   `packages/prototypes/app/p/<slug>/`:

   ```bash
   cp -r packages/prototypes/app/p/example packages/prototypes/app/p/<slug>
   ```

2. Rewrite `packages/prototypes/app/p/<slug>/meta.ts` using the template below
   (fill in the user's values; never leave placeholder strings).

3. Rewrite `packages/prototypes/app/p/<slug>/page.tsx` using the template below
   (generate a `tabs` entry for every tab the user requested).

4. Delete any screen files that came from `example/screens/` and recreate one
   stub screen file per tab under `<slug>/screens/`, using the screen stub
   template below.

### Mode B: duplicate an existing prototype

1. Ask the user which existing prototype to duplicate. Read every
   `packages/prototypes/app/p/*/meta.ts` and list the slugs + titles for
   confirmation.

2. Copy the chosen folder:

   ```bash
   cp -r packages/prototypes/app/p/<source-slug> packages/prototypes/app/p/<new-slug>
   ```

3. Rewrite `meta.ts` in the new folder (new title, description, author, createdAt,
   `status: 'draft'`).

4. Leave `page.tsx` and `screens/` in place — the duplicate is a starting point
   the user will iterate on. Note any tab renames or additions and apply them now
   if the user specified them.

## 3. Wire-up rules

- **Screens use only `@goodparty_org/styleguide` + hardcoded content.** No
  `fetch`, no service imports, no Prisma, no `gp-api` calls, no auth, no env
  vars. All data is inline.
- **`AppShell` takes `userName` + `orgs`.** Each `ShellOrg` is a GoodParty
  organization/workspace (an elected office = Serve, or a campaign = Win); its
  `tabs` are the sidebar nav. The header org picker switches orgs (swapping the
  nav); the footer is the user account menu. Shapes (from `@/shared/AppShell`):
  ```ts
  type PrototypeTab = {
    slug: string // kebab-case, unique within the org
    label: string // display label in the sidebar
    icon: LucideIcon // lucide-react component (not a string)
    component: ReactNode
  }
  type ShellOrg = {
    id: string // 'serve' | 'win' (or your own)
    name: string // org name in the picker, e.g. 'Pittsboro Town Council'
    isPro: boolean // shows the PRO badge next to GoodParty.org
    tabs: PrototypeTab[]
  }
  ```
- **`meta.ts` exports `Omit<PrototypeMeta, 'slug'>`** (from `@/shared/prototypeMeta`):
  ```ts
  type PrototypeMeta = {
    slug: string // derived from the folder name at build time; omitted here
    title: string
    description: string
    author: string // email of the person creating this prototype
    createdAt: string // ISO date string YYYY-MM-DD
    status: 'draft' | 'handoff-ready' | 'shipped'
  }
  ```

## 4. File templates

Use these templates exactly. Replace ALL-CAPS placeholders with real values.

### `meta.ts`

```ts
import type { PrototypeMeta } from '@/shared/prototypeMeta'

const meta: Omit<PrototypeMeta, 'slug'> = {
  title: 'TITLE',
  description: 'DESCRIPTION',
  author: 'AUTHOR_EMAIL',
  createdAt: 'YYYY-MM-DD',
  status: 'draft',
}

export default meta
```

### `page.tsx` (example: three tabs — Overview, Contacts, Messages)

```tsx
'use client'

import { LayoutDashboard, UsersRound, Send } from 'lucide-react'
import { AppShell, type ShellOrg } from '@/shared/AppShell'
import { Overview } from './screens/Overview'
import { Contacts } from './screens/Contacts'
import { Messages } from './screens/Messages'

const orgs: ShellOrg[] = [
  {
    id: 'serve',
    name: 'Pittsboro Town Council',
    isPro: false,
    tabs: [
      {
        slug: 'overview',
        label: 'Overview',
        icon: LayoutDashboard,
        component: <Overview />,
      },
      {
        slug: 'contacts',
        label: 'Contacts',
        icon: UsersRound,
        component: <Contacts />,
      },
      {
        slug: 'messages',
        label: 'Messages',
        icon: Send,
        component: <Messages />,
      },
    ],
  },
]

const Page = () => <AppShell userName="USER_NAME" orgs={orgs} />

export default Page
```

Generate the `tabs` inside the org from the actual tab list the user provided.
Import the matching icon for each, and import each screen from `./screens/TAB_NAME`.
A single org is fine; add a second entry to `orgs` (e.g. a `win` campaign
workspace) to demonstrate the org picker between GoodParty's Serve and Win
products.

### Screen stub (one file per tab, e.g. `screens/Overview.tsx`)

```tsx
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@goodparty_org/styleguide'

export const Overview = () => (
  <div className="p-6 space-y-4">
    <Card>
      <CardHeader>
        <CardTitle>Overview</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">Overview content goes here.</p>
      </CardContent>
    </Card>
  </div>
)
```

Create one stub per tab. Name the file and the exported component after the
tab label in PascalCase (e.g. tab "Voter Map" → file `VoterMap.tsx`, export
`VoterMap`). Each stub is a starting point — hardcode realistic placeholder
content relevant to the tab name rather than a generic "content goes here"
message where the intent is clear.

## 5. Finish

1. Start or refresh the dev server in the background:

   ```bash
   npm run dev -w packages/prototypes
   ```

   The app runs on port **4002**.

2. Open the new prototype in the browser:

   ```
   http://localhost:4002/p/<slug>
   ```

   Use the `run` skill or the Playwright MCP (`browser_navigate`) to open the
   URL and screenshot the new shell. Confirm all tabs render without errors.

3. Report the slug, the URL, and the list of screen files created to the user.

4. If this was invoked from the `prototype` skill, hand back to prototype mode
   for iteration. The session stays in prototype mode — production constraints
   remain off.
