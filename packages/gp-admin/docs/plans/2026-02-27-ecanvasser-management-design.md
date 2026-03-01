# Ecanvasser Management in gp-admin

## Summary

Add ecanvasser integration management to gp-admin, allowing admins to list, create, sync, and delete ecanvasser API key integrations. Mirrors the functionality from gp-webapp's admin ecanvasser page but uses Radix UI table layout and gp-sdk for API interactions.

## Permission

Add `MANAGE_ECANVASSER: 'org:admin_portal:manage_ecanvasser'` to `PERMISSIONS` in `lib/permissions.ts`. The sidebar nav item and page both gate on this permission.

## Sidebar

Add nav item to `navItems.ts`:
- Title: "Ecanvasser"
- Href: `/dashboard/ecanvasser`
- Permission: `PERMISSIONS.MANAGE_ECANVASSER`

## Route

`src/app/dashboard/ecanvasser/page.tsx` — server component with permission guard (redirects to `/dashboard/users` if unauthorized). Renders `EcanvasserPage` client component.

## Server Actions

`src/app/dashboard/ecanvasser/actions.ts` using `gpAction` + SDK:
- `listEcanvassers()` — `client.ecanvasser.list()` returns `EcanvasserSummary[]`
- `createEcanvasser(input)` — `client.ecanvasser.create({apiKey, email})`
- `syncAllEcanvassers()` — `client.ecanvasser.syncAll()` then re-list
- `deleteEcanvasser(campaignId)` — `client.ecanvasser.delete(campaignId)`

## Components

All under `src/app/dashboard/ecanvasser/components/`:

### EcanvasserPage.tsx
Client component. Header with "Sync All" and "Add API Key" buttons. Fetches list on mount via `listEcanvassers` action. Shows `LoadingSpinner` during loads, then the table.

### EcanvasserTable.tsx
Radix `Table` with columns: Campaign ID, Email, Contacts, Houses, Interactions, Last Sync, Error, Actions (delete button with confirmation).

### AddEcanvasserDialog.tsx
Radix `Dialog` with react-hook-form + zod: email and apiKey fields. Calls `createEcanvasser` action on submit. Closes and refreshes list on success.

## Out of Scope
- Individual sync per campaign (SDK doesn't expose this)
- Update/edit existing integrations (SDK has no update method)
- Surveys, teams, question management (campaign-owner features)
