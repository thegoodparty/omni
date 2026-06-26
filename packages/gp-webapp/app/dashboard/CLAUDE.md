# app/dashboard/

The candidate dashboard. Authenticated shell that hosts campaign tools, polls, voter outreach, content, and admin-adjacent flows. Every route under `dashboard/` runs inside `DashboardLayout` and assumes a logged-in user with a current campaign.

## Key files

| File | Role |
|------|------|
| `page.tsx` | Dashboard home — campaign overview |
| `shared/DashboardLayout.tsx` | Layout wrapper — sidebar, header, auth gating. Pass `navHeader={{ icon, label }}` to render a full-bleed in-body header that mirrors the active nav item (used by the Serve tabs) |
| `shared/DashboardNavHeader.tsx` | The shared full-bleed icon + tab-name header bar rendered by `DashboardLayout` for `navHeader`; Community Issues' `IssuesNavHeader` also delegates to it |
| `shared/DashboardMenu.tsx` | Sidebar nav items (per-feature visibility lives here) |
| `shared/candidateAccess.ts` + `serveAccess.ts` | Access predicates (`canViewX` helpers) — client + server variants |
| `shared/ProUpgradeModal.tsx` / `ProUpgradePrompt.tsx` | Pro-tier gating UI |
| `components/` | Cross-feature dashboard widgets (alert banners, progress bars, `campaignManager/`) |

## Patterns

- **Per-feature dirs** under `dashboard/` own their own routes, components, and (sometimes) hooks. Keep cross-feature components in `dashboard/components/` and cross-feature primitives/access checks in `dashboard/shared/`.
- **Access gating**: use `candidateAccess.ts` from client code, `serveAccess.ts` from server components. Don't read the user object directly to gate UI — go through the helpers so rules stay in one place.
- **Pro-only features** wrap their content in `ProUpgradeModal` / `ProUpgradePrompt`. Free users see the prompt; pro users see the feature.
- **Sidebar visibility** is driven by the menu config in `DashboardMenu.tsx` — adding a feature route means adding a menu entry there too.
- **In-body tab header**: Serve tab pages pass `navHeader={{ icon, label }}` to `DashboardLayout` so the body opens with a full-bleed bar mirroring the nav item (icon + tab name). It also suppresses the redundant mobile top-bar title. `icon` is a string key (e.g. `'sparkles'`), not a component reference: the chief-of-staff and briefings pages are Server Components, and a function/component prop can't cross the RSC boundary into the client `DashboardLayout`. Add new keys to `NAV_HEADER_ICONS` in `DashboardNavHeader.tsx`. Match the page's `DashboardMenu` icon/label, and drop any in-page heading that just repeats the tab name (the bar is the title).

## Gotchas

- The directory has more subdirs than the sidebar exposes (`account/`, `briefings/`, `campaign-details/`, `campaign-plan/`, `election-result/`, `pro-upgrade/`, `profile/`, `purchase/`, `questions/`, `voter-records/`). These are mostly internal flows / sub-pages reached from within other features — don't assume "directory exists" means "menu item exists." (`pro-upgrade/` is the pre-payment Pro upgrade wizard; it superseded the now-deleted `pro-sign-up/` + `upgrade-to-pro/` trees — see `pro-upgrade/CLAUDE.md`.)
- `dashboard/shared/` and `dashboard/components/` overlap in spirit. Convention: `shared/` = layout, access, modals reused across features; `components/` = card-style widgets composed onto pages. Check both before adding a new file.
- `DashboardLayout` enforces auth. Pages don't need their own redirect-to-login logic.

## Related

- Feature dirs each have their own `CLAUDE.md` — start there if you're working in `outreach/`, `polls/`, `website/`, etc.
- **Pro upgrade / 10DLC compliance** — `pro-upgrade/CLAUDE.md` (the pre-payment wizard) + its gp-api counterpart `packages/gp-api/src/campaigns/tcrCompliance/CLAUDE.md` (the agentic `compliance_setup` flow).
- `app/shared/user/UserProvider.tsx` — auth state the layout reads.
- `app/shared/hooks/CampaignProvider.tsx` — current campaign context.
- **Adding analytics to a feature here** — fire events per the `instrument-analytics-event` skill (repo root `.claude/skills/instrument-analytics-event/SKILL.md`).
