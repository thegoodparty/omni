# app/dashboard/campaign-story/

Candidate-facing "Campaign Story" page: three prompts (your why, your
background, your issues) that capture the narrative foundation reused across the
campaign plan, stump speech, and voter messaging.

## Key files

| File | Role |
|------|------|
| `page.tsx` | Route entry — `candidateAccess()` then renders the client page |
| `components/CampaignStoryPage.tsx` | Layout: `FeatureFlagGuard` → `DashboardLayout`, header, intro, section list |
| `components/CampaignStoryCard.tsx` | One prompt card — textarea + char counter (`/100`, soft suggestion, not enforced) + Campaign Manager hint + "Help me rewrite" |

## Patterns

- **Gated behind the `campaign-story` Amplitude flag** via `FeatureFlagGuard`
  (route) and `useCampaignStoryFlag()` in `DashboardMenu.tsx` (sidebar item). Flag
  key lives in `@shared/experiments/campaignStoryFlag.ts`.
- **UI shell only.** Textarea content is local component state — nothing
  persists yet. "Help me rewrite" is a non-functional placeholder. Wiring
  persistence (gp-api campaign fields) and the rewrite action are follow-ups.
- **Campaign Manager hint** is length-driven (empty → "say more" → hidden past
  `SUGGESTED_CHARS`). It deliberately stops at the "say more" nudge; quality
  praise ("strong, specific…") waits for the real rewrite AI, since a length
  signal can't judge quality.

## Related

- `app/shared/experiments/campaignStoryFlag.ts` — flag wrapper hook + key.
- `app/dashboard/shared/DashboardMenu.tsx` — sidebar entry (campaign category).
