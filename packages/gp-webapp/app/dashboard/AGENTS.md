# app/dashboard/

The candidate dashboard. Authenticated shell that hosts campaign tools, polls, voter outreach, content, and admin-adjacent flows. Every route under `dashboard/` runs inside `DashboardLayout` and assumes a logged-in user with a current campaign.

## Key files

| File | Role |
|------|------|
| `page.tsx` | Dashboard home — campaign overview |
| `shared/DashboardLayout.tsx` | Layout wrapper — sidebar, header, auth gating. Pass `navHeader={{ icon, label }}` to render a full-bleed in-body header that mirrors the active nav item (every main nav page uses it) |
| `shared/DashboardNavHeader.tsx` | The shared full-bleed icon + tab-name header bar rendered by `DashboardLayout` for `navHeader`; Community Issues' `IssuesNavHeader` also delegates to it |
| `shared/DashboardNavHeaderAction.tsx` | Portals a page's primary CTA into that bar, aligned top right, from anywhere below `DashboardLayout` |
| `shared/navLabels.ts` | `NAV_HEADER_ICONS` + `NAV_LABELS` — the one source both `DashboardMenu` and the title bars read, so a tab's icon/name can't drift from its page |
| `shared/DashboardMenu.tsx` | Sidebar nav items (per-feature visibility lives here) |
| `shared/candidateAccess.ts` + `serveAccess.ts` | Access predicates (`canViewX` helpers) — client + server variants |
| `shared/ProUpgradeModal.tsx` / `ProUpgradePrompt.tsx` | Pro-tier gating UI |
| `components/` | Cross-feature dashboard widgets (alert banners, progress bars, `campaignManager/`) |

## Patterns

- **Per-feature dirs** under `dashboard/` own their own routes, components, and (sometimes) hooks. Keep cross-feature components in `dashboard/components/` and cross-feature primitives/access checks in `dashboard/shared/`.
- **Access gating**: use `candidateAccess.ts` from client code, `serveAccess.ts` from server components. Don't read the user object directly to gate UI — go through the helpers so rules stay in one place.
- **Pro-only features** wrap their content in `ProUpgradeModal` / `ProUpgradePrompt`. Free users see the prompt; pro users see the feature.
- **Sidebar visibility** is driven by the menu config in `DashboardMenu.tsx` — adding a feature route means adding a menu entry there too.
- **In-body tab header (every main nav page)**: pages pass `navHeader={{ icon, label }}` to `DashboardLayout` so the body opens with a full-bleed bar mirroring the nav item (icon + tab name). **Voter Data is the reference implementation** — white `bg-background`, `border-b`, `px-6`, fixed `h-14`, a `size-5` icon and a `text-base font-semibold` h1. Every main nav page now runs this same bar: Campaign Manager, Your story, Campaign Tracker, Know Your Opponent, Public Profile, plus the Serve tabs (chief-of-staff, briefings, community-issues, ordinances, polls) and Voter Data itself. Don't hand-roll a per-page title band; use this.
- **Icons and labels come from `shared/navLabels.ts`**, not from literals. `NAV_HEADER_ICONS` maps a serializable string key (e.g. `'sparkles'`) to the icon component, and `DashboardMenu` resolves its `v2Icon` from the same map while both read tab names from `NAV_LABELS` — that shared source is what keeps the top of a page identical to the left rail (the drift it fixes: the bar read "Know Your Opponent" with a swords icon while the nav item used a flag). The key is a string, not a component reference, because the pages that set `navHeader` (chief-of-staff, briefings, race-opponent, public-profile) are Server Components and a component prop can't cross the RSC boundary into the client `DashboardLayout`. Add new icons to `NAV_HEADER_ICONS`, new tab names to `NAV_LABELS`, and drop any in-page heading that just repeats the tab name (the bar is the title).
- **CTA in the title bar**: a page whose bar carries a primary action renders it through `DashboardNavHeaderAction` (`shared/DashboardNavHeaderAction.tsx`) — a portal into a slot inside the bar, `ml-auto` so it lands top right. It's a portal rather than a prop because each of these CTAs owns state far below the layout (`StoryEditorForm`'s Save, `CampaignTrackerHero`'s Download, `RaceOpponentList`'s Export brief, `PublicProfileEditor`'s publish toggle + Save) and two of those pages are RSCs. With no slot in context it renders in place, so component tests can mount the owner without the layout. Mounting one also tells the bar a CTA exists, which is what keeps the bar visible below `lg` (title hidden, CTA shown — the CTA has nowhere else to go on mobile). That is **observed, not declared**: `DashboardNavHeaderAction` registers on mount and unregisters on unmount, and `DashboardLayout` counts them. There is deliberately no `hasAction` prop — a page-level flag read true for every state of its route, so states with no CTA (Know Your Opponent's processing screen, Public Profile before the profile is minted, the story gate, a story still loading) rendered an empty 56px bar on mobile. Scale the CTA to the bar: `size="small"` buttons / `!h-8` icon buttons, so the bar stays 56px on every page.
- **Mobile titles**: the bar's title is desktop-only (`hidden lg:flex`) because on mobile it moves into the top bar (`MobileMenuTrigger`), so any route with a navHeader needs a matching entry in `MOBILE_PAGE_TITLES` — except the three resolved before that table in `getMobilePageTitle`: `/dashboard` and `/dashboard/campaign-plan` are matched exactly (a `/dashboard` prefix entry would mistitle every unlisted subroute, and the plan tab's name depends on the campaign-story flag), and contacts is resolved separately by Win/Serve.

## Gotchas

- The directory has more subdirs than the sidebar exposes (`account/`, `briefings/`, `campaign-details/`, `campaign-plan/`, `election-result/`, `pro-upgrade/`, `profile/`, `purchase/`, `questions/`). These are mostly internal flows / sub-pages reached from within other features — don't assume "directory exists" means "menu item exists." (`pro-upgrade/` is the pre-payment Pro upgrade wizard; it superseded the now-deleted `pro-sign-up/` + `upgrade-to-pro/` trees — see `pro-upgrade/CLAUDE.md`.)
- `dashboard/shared/` and `dashboard/components/` overlap in spirit. Convention: `shared/` = layout, access, modals reused across features; `components/` = card-style widgets composed onto pages. Check both before adding a new file.
- `DashboardLayout` enforces auth. Pages don't need their own redirect-to-login logic.

## Related

- Feature dirs each have their own `CLAUDE.md` — start there if you're working in `outreach/`, `polls/`, `website/`, `race-opponent/` (Know Your Opponent — Pro gated), etc.
- **Pro upgrade / 10DLC compliance** — `pro-upgrade/CLAUDE.md` (the pre-payment wizard) + its gp-api counterpart `packages/gp-api/src/campaigns/tcrCompliance/CLAUDE.md` (the agentic `compliance_setup` flow).
- `app/shared/user/UserProvider.tsx` — auth state the layout reads.
- `app/shared/hooks/CampaignProvider.tsx` — current campaign context.
- **Adding analytics to a feature here** — fire events per the `instrument-analytics-event` skill (repo root `.claude/skills/instrument-analytics-event/SKILL.md`).
