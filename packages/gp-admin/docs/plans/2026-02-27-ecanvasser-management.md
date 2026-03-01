# Ecanvasser Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add ecanvasser integration management to gp-admin with permission-gated sidebar link, server actions via SDK, and Radix UI table/dialog components.

**Architecture:** New `/dashboard/ecanvasser` route with server-side Clerk permission guard. Client components fetch data via server actions that wrap `gpAction` + `client.ecanvasser.*` SDK calls. Table lists integrations; dialog creates new ones.

**Tech Stack:** Next.js App Router, Clerk permissions, Radix UI themes, react-hook-form + zod, gp-sdk (`@goodparty_org/sdk` / `@goodparty_org/contracts`)

---

### Task 1: Add permission constant and sidebar nav item

**Files:**
- Modify: `src/lib/permissions.ts:7-14`
- Modify: `src/shared/layout/navItems.ts`

**Step 1: Add MANAGE_ECANVASSER permission**

In `src/lib/permissions.ts`, add to the `PERMISSIONS` object:

```typescript
export const PERMISSIONS = {
  READ_USERS: 'org:admin_portal:read_users',
  WRITE_USERS: 'org:admin_portal:write_users',
  READ_CAMPAIGNS: 'org:admin_portal:read_campaigns',
  WRITE_CAMPAIGNS: 'org:admin_portal:write_campaigns',
  MANAGE_SETTINGS: 'org:admin_portal:manage_settings',
  MANAGE_INVITES: 'org:admin_portal:manage_invites',
  MANAGE_ECANVASSER: 'org:admin_portal:manage_ecanvasser',
} as const
```

**Step 2: Add sidebar nav item**

In `src/shared/layout/navItems.ts`, add an icon import and a new entry. Use `HiGlobeAlt` from `react-icons/hi` (ecanvasser is an external integration). Add it before the Settings entry:

```typescript
import { HiUsers, HiCog, HiUserGroup, HiGlobeAlt } from 'react-icons/hi'
import { PERMISSIONS, Permission } from '@/lib/permissions'
import { IconType } from 'react-icons'

export interface NavItem {
  title: string
  href: string
  icon: IconType
  permission: Permission
}

export const navItems: NavItem[] = [
  {
    title: 'Users',
    href: '/dashboard/users',
    icon: HiUsers,
    permission: PERMISSIONS.READ_USERS,
  },
  {
    title: 'Members (Internal)',
    href: '/dashboard/members',
    icon: HiUserGroup,
    permission: PERMISSIONS.MANAGE_INVITES,
  },
  {
    title: 'Ecanvasser',
    href: '/dashboard/ecanvasser',
    icon: HiGlobeAlt,
    permission: PERMISSIONS.MANAGE_ECANVASSER,
  },
  {
    title: 'Settings',
    href: '/dashboard/settings',
    icon: HiCog,
    permission: PERMISSIONS.MANAGE_SETTINGS,
  },
]
```

**Step 3: Verify build**

Run: `npm run lint && npm run build`
Expected: PASS (the route doesn't exist yet but the sidebar only renders for users with the permission, and unused nav items won't break anything)

**Step 4: Commit**

```bash
git add src/lib/permissions.ts src/shared/layout/navItems.ts
git commit -m "feat: add MANAGE_ECANVASSER permission and sidebar nav item"
```

---

### Task 2: Create server actions

**Files:**
- Create: `src/app/dashboard/ecanvasser/actions.ts`

**Step 1: Write the server actions file**

```typescript
'use server'

import { revalidatePath } from 'next/cache'
import { gpAction } from '@/shared/util/gpClient.util'
import type { CreateEcanvasserInput, EcanvasserSummary } from '@goodparty_org/sdk'

export const listEcanvassers = async (): Promise<EcanvasserSummary[]> =>
  gpAction(async (client) => {
    return client.ecanvasser.list()
  })

export const createEcanvasser = async (input: CreateEcanvasserInput) =>
  gpAction(async (client) => {
    const result = await client.ecanvasser.create(input)
    revalidatePath('/dashboard/ecanvasser')
    return result
  })

export const syncAllEcanvassers = async (): Promise<EcanvasserSummary[]> =>
  gpAction(async (client) => {
    await client.ecanvasser.syncAll()
    return client.ecanvasser.list()
  })

export const deleteEcanvasser = async (campaignId: number): Promise<void> =>
  gpAction(async (client) => {
    await client.ecanvasser.delete(campaignId)
    revalidatePath('/dashboard/ecanvasser')
  })
```

> **Note:** Check whether `EcanvasserSummary` is exported from `@goodparty_org/sdk` or `@goodparty_org/contracts`. The SDK re-exports contract types — verify with the actual import. If not available from `@goodparty_org/sdk`, import from `@goodparty_org/contracts`.

**Step 2: Verify build**

Run: `npm run lint && npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/app/dashboard/ecanvasser/actions.ts
git commit -m "feat: add ecanvasser server actions"
```

---

### Task 3: Create the page route with permission guard

**Files:**
- Create: `src/app/dashboard/ecanvasser/page.tsx`

**Step 1: Write the page**

Follow the exact pattern from `src/app/dashboard/members/page.tsx`:

```typescript
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { PERMISSIONS } from '@/lib/permissions'
import { EcanvasserPage } from './components/EcanvasserPage'
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Ecanvasser | GP Admin',
  description: 'Manage ecanvasser integrations',
}

export default async function Page() {
  const { has, orgId } = await auth()

  if (!has?.({ permission: PERMISSIONS.MANAGE_ECANVASSER }) || !orgId) {
    redirect('/dashboard/users')
  }

  return <EcanvasserPage />
}
```

**Step 2: Create a placeholder EcanvasserPage component so build passes**

Create `src/app/dashboard/ecanvasser/components/EcanvasserPage.tsx`:

```typescript
'use client'

import { Container, Heading } from '@radix-ui/themes'

export function EcanvasserPage() {
  return (
    <Container size="4">
      <Heading size="6" mb="4">
        Ecanvasser
      </Heading>
    </Container>
  )
}
```

**Step 3: Verify build**

Run: `npm run lint && npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add src/app/dashboard/ecanvasser/
git commit -m "feat: add ecanvasser page route with permission guard"
```

---

### Task 4: Implement EcanvasserTable component

**Files:**
- Create: `src/app/dashboard/ecanvasser/components/EcanvasserTable.tsx`

**Step 1: Write the table component**

Follow the pattern from `src/app/dashboard/users/components/UserList.tsx` but adapted for `EcanvasserSummary` data:

```typescript
'use client'

import { useState } from 'react'
import { Table, Text, IconButton, Flex, Badge } from '@radix-ui/themes'
import { HiTrash } from 'react-icons/hi'
import type { EcanvasserSummary } from '@goodparty_org/sdk'
import { deleteEcanvasser } from '../actions'

interface EcanvasserTableProps {
  ecanvassers: EcanvasserSummary[]
  onUpdate: () => void
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString()
}

export function EcanvasserTable({
  ecanvassers,
  onUpdate,
}: EcanvasserTableProps) {
  const [deletingId, setDeletingId] = useState<number | null>(null)

  if (ecanvassers.length === 0) {
    return (
      <Text color="gray" size="3">
        No ecanvasser integrations found.
      </Text>
    )
  }

  async function handleDelete(campaignId: number) {
    if (!window.confirm('Delete this ecanvasser integration?')) return
    setDeletingId(campaignId)
    try {
      await deleteEcanvasser(campaignId)
      onUpdate()
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeaderCell>Campaign ID</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Email</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Contacts</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Houses</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Interactions</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Last Sync</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Error</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Actions</Table.ColumnHeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {ecanvassers.map((item) => (
          <Table.Row key={item.campaignId}>
            <Table.Cell>{item.campaignId ?? '—'}</Table.Cell>
            <Table.Cell>{item.email ?? '—'}</Table.Cell>
            <Table.Cell>{formatNumber(item.contacts)}</Table.Cell>
            <Table.Cell>{formatNumber(item.houses)}</Table.Cell>
            <Table.Cell>{formatNumber(item.interactions)}</Table.Cell>
            <Table.Cell>{formatDate(item.lastSync)}</Table.Cell>
            <Table.Cell>
              {item.error ? (
                <Badge color="red">{item.error}</Badge>
              ) : (
                '—'
              )}
            </Table.Cell>
            <Table.Cell>
              <Flex>
                <IconButton
                  variant="ghost"
                  color="red"
                  aria-label="Delete integration"
                  onClick={() =>
                    item.campaignId !== undefined &&
                    handleDelete(item.campaignId)
                  }
                  disabled={deletingId === item.campaignId}
                >
                  <HiTrash />
                </IconButton>
              </Flex>
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  )
}
```

> **Note:** `EcanvasserSummary.campaignId` is typed as `number | undefined` in the contracts. Handle the `undefined` case with `?? '—'` in display and a guard before `handleDelete`.

**Step 2: Verify build**

Run: `npm run lint && npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/app/dashboard/ecanvasser/components/EcanvasserTable.tsx
git commit -m "feat: add EcanvasserTable component"
```

---

### Task 5: Implement AddEcanvasserDialog component

**Files:**
- Create: `src/app/dashboard/ecanvasser/components/AddEcanvasserDialog.tsx`

**Step 1: Write the dialog component**

Uses Radix `Dialog`, `react-hook-form`, and `zod` following gp-admin patterns:

```typescript
'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, Dialog, Flex, Text, TextField } from '@radix-ui/themes'
import { ErrorText } from '@/components/ErrorText'
import { createEcanvasser } from '../actions'

const FORM_MODE = { ON_CHANGE: 'onChange' } as const

const addEcanvasserSchema = z.object({
  email: z.string().email('Invalid email address'),
  apiKey: z.string().min(1, 'API key is required'),
})

type AddEcanvasserFormData = z.infer<typeof addEcanvasserSchema>

interface AddEcanvasserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

export function AddEcanvasserDialog({
  open,
  onOpenChange,
  onCreated,
}: AddEcanvasserDialogProps) {
  const [isSaving, setIsSaving] = useState(false)

  const {
    register,
    getValues,
    reset,
    formState: { errors, isValid },
  } = useForm<AddEcanvasserFormData>({
    mode: FORM_MODE.ON_CHANGE,
    resolver: zodResolver(addEcanvasserSchema),
    defaultValues: { email: '', apiKey: '' },
  })

  async function handleSubmit() {
    const data = getValues()
    const result = addEcanvasserSchema.safeParse(data)
    if (!result.success) return

    setIsSaving(true)
    try {
      await createEcanvasser(result.data)
      reset()
      onOpenChange(false)
      onCreated()
    } finally {
      setIsSaving(false)
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Content maxWidth="450px">
        <Dialog.Title>Add Ecanvasser Integration</Dialog.Title>
        <Dialog.Description size="2" mb="4">
          Enter the email of the campaign leader and their Ecanvasser API key.
        </Dialog.Description>

        <Flex direction="column" gap="3">
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Email
            </Text>
            <TextField.Root
              {...register('email')}
              type="email"
              placeholder="user@example.com"
              color={errors.email ? 'red' : undefined}
            />
            {errors.email && <ErrorText>{errors.email.message}</ErrorText>}
          </label>

          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              API Key
            </Text>
            <TextField.Root
              {...register('apiKey')}
              placeholder="Ecanvasser API key"
              color={errors.apiKey ? 'red' : undefined}
            />
            {errors.apiKey && <ErrorText>{errors.apiKey.message}</ErrorText>}
          </label>
        </Flex>

        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray" disabled={isSaving}>
              Cancel
            </Button>
          </Dialog.Close>
          <Button
            onClick={handleSubmit}
            disabled={!isValid || isSaving}
            loading={isSaving}
          >
            Add
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  )
}
```

**Step 2: Verify build**

Run: `npm run lint && npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/app/dashboard/ecanvasser/components/AddEcanvasserDialog.tsx
git commit -m "feat: add AddEcanvasserDialog component"
```

---

### Task 6: Wire up EcanvasserPage with table, dialog, and actions

**Files:**
- Modify: `src/app/dashboard/ecanvasser/components/EcanvasserPage.tsx`

**Step 1: Replace the placeholder with the full implementation**

```typescript
'use client'

import { useEffect, useState } from 'react'
import { Button, Container, Flex, Heading, Text } from '@radix-ui/themes'
import type { EcanvasserSummary } from '@goodparty_org/sdk'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { useToast } from '@/components/Toast'
import { listEcanvassers, syncAllEcanvassers } from '../actions'
import { EcanvasserTable } from './EcanvasserTable'
import { AddEcanvasserDialog } from './AddEcanvasserDialog'

export function EcanvasserPage() {
  const [ecanvassers, setEcanvassers] = useState<EcanvasserSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const { showToast } = useToast()

  async function loadEcanvassers() {
    setIsLoading(true)
    try {
      const data = await listEcanvassers()
      setEcanvassers(data)
    } catch {
      showToast('Failed to load ecanvassers')
    } finally {
      setIsLoading(false)
    }
  }

  async function handleSyncAll() {
    setIsSyncing(true)
    try {
      const data = await syncAllEcanvassers()
      setEcanvassers(data)
      showToast('Sync complete')
    } catch {
      showToast('Sync failed')
    } finally {
      setIsSyncing(false)
    }
  }

  useEffect(() => {
    loadEcanvassers()
  }, [])

  return (
    <Container size="4">
      <Flex justify="between" align="center" mb="4">
        <div>
          <Heading size="6">Ecanvasser</Heading>
          <Text size="2" color="gray">
            Manage ecanvasser API key integrations.{' '}
            <a
              href="https://support.ecanvasser.com/en/articles/7019426-access-your-api-key"
              target="_blank"
              rel="noreferrer"
              className="text-[var(--accent-11)] underline"
            >
              How to get an API key
            </a>
          </Text>
        </div>
        <Flex gap="3">
          <Button
            variant="soft"
            onClick={handleSyncAll}
            disabled={isSyncing || isLoading}
            loading={isSyncing}
          >
            Sync All
          </Button>
          <Button onClick={() => setDialogOpen(true)} disabled={isLoading}>
            Add API Key
          </Button>
        </Flex>
      </Flex>

      {isLoading ? (
        <LoadingSpinner>Loading ecanvassers...</LoadingSpinner>
      ) : (
        <EcanvasserTable
          ecanvassers={ecanvassers}
          onUpdate={loadEcanvassers}
        />
      )}

      <AddEcanvasserDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={loadEcanvassers}
      />
    </Container>
  )
}
```

**Step 2: Verify lint and build**

Run: `npm run lint && npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/app/dashboard/ecanvasser/components/EcanvasserPage.tsx
git commit -m "feat: wire up EcanvasserPage with table, dialog, and actions"
```

---

### Task 7: Final verification

**Step 1: Run full lint + build**

Run: `npm run lint && npm run build`
Expected: PASS with zero errors

**Step 2: Run tests**

Run: `npm run test`
Expected: All existing tests still pass

**Step 3: Final commit (if any lint fixes were needed)**

```bash
git add -A
git commit -m "chore: lint fixes for ecanvasser feature"
```
