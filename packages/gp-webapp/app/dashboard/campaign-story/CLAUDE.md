# app/dashboard/campaign-story/

Candidate-facing "Campaign Story" page: three prompts (your why, your
background, your issues) that capture the narrative foundation reused across the
campaign plan, stump speech, and voter messaging.

## Key files

| File | Role |
|------|------|
| `page.tsx` | Route entry — `candidateAccess()`, server-fetches the saved story, renders the client page |
| `components/CampaignStoryPage.tsx` | Layout: `FeatureFlagGuard` → `DashboardLayout`, header, intro, section list; threads each saved value to its card |
| `components/CampaignStoryCard.tsx` | One prompt card — textarea (char counter at its bottom-right, `/100` soft suggestion, not enforced) + Campaign Manager hint + "Help me rewrite" |

## Patterns

- **Gated behind the `campaign-story` Amplitude flag** via `FeatureFlagGuard`
  (route) and `useCampaignStoryFlag()` in `DashboardMenu.tsx` (sidebar item). Flag
  key lives in `@shared/experiments/campaignStoryFlag.ts`.
- **Persistence.** `page.tsx` server-fetches `GET /v1/campaigns/mine/story` to
  seed each card; each card autosaves its own field on blur via
  `PUT /v1/campaigns/mine/story` (partial body, one field). Backed by the
  `campaign_story` table in gp-api (`src/campaignStory/`); response shape is
  `CampaignStory` from `@goodparty_org/contracts`.
- **"Help me rewrite"** is still a non-functional placeholder — wiring the AI
  rewrite is a separate ticket.
- **Campaign Manager hint** is length-driven and always visible: empty → "say
  more" → positive once past `SUGGESTED_CHARS`. It deliberately avoids quality
  claims ("strong, specific…") from a length signal — that waits for the real
  rewrite AI.

## Related

- `app/shared/experiments/campaignStoryFlag.ts` — flag wrapper hook + key.
- `app/dashboard/shared/DashboardMenu.tsx` — sidebar entry (campaign category).
- `packages/gp-api/src/campaignStory/` — table, endpoints, service.
