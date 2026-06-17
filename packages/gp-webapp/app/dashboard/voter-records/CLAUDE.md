# app/dashboard/voter-records/

The **legacy** voter-file experience for Win campaigns: a catalog of pre-built and
custom voter-file spreadsheets you browse, request, and download. Pro-gated
(`campaign.isPro`), candidate-only (`candidateAccess()`).

## Status — being superseded by the unified Contacts path

The Win voter experience is moving onto the People API. The new home is the shared
`/dashboard/contacts` route (Serve + Win on one People-API-backed surface), gated by
the `win-voter-data` flag + `campaign.isPro`. See `app/dashboard/contacts/CLAUDE.md`
and `docs/architecture.md` (voter/people data path).

This page is **not removed yet** — it still serves un-migrated Win users until the
post-rollout cleanup (ENG-10436). Don't delete it, and don't describe it as the
current/primary Win voter source. New Win voter work goes in `dashboard/contacts/`,
not here.

## Key files

| File                                                          | Role                                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------------- |
| `page.tsx`                                                    | Server route — Pro gate + `candidateAccess()`, fetches `canDownload` |
| `components/VoterRecordsPage.tsx`                             | Catalog of voter-file types + custom files                           |
| `components/CustomVoterFile.tsx` / `CustomVoterAudience*.tsx` | Build a custom file (channel, purpose, audience filters)             |
| `[type]/components/VoterFileDetailPage.tsx`                   | Per-file detail, download, recommended actions                       |
| `utils.ts`                                                    | `fetchCanDownload()` server helper                                   |

## Data source

This page reads the older voter-file endpoints (`apiRoutes.voters.voterFile.*` —
`get`, `canDownload`, `wakeUp`), the pre-People-API Win voter path. The unified
Contacts experience instead uses `GET /v1/contacts` and the People-API-backed
voter-file filter endpoints. When working here, keep using the existing
`voters.voterFile.*` routes; do not mix the two paths in one view.

## Analytics

Events fire under the `VoterData` group in `helpers/analyticsHelper.ts` (legacy).
The unified Contacts experience uses the `Contacts` group, whose events carry a
`context: 'win' | 'serve'` property. Don't reuse `VoterData` events for new
Contacts work — see `.claude/skills/instrument-analytics-event/SKILL.md`.

## Related

- `app/dashboard/contacts/CLAUDE.md` — the unified People-API Contacts experience that supersedes this page.
- `docs/architecture.md` — voter/people data path.
