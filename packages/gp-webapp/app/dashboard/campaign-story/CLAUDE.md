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
- **"Help me rewrite"** calls `POST /v1/campaigns/mine/story/rewrite` (Gemini
  Flash, server-side) with the section id + current text; gp-api pairs it with
  the candidate's name and a section-specific, non-partisan prompt. The
  suggestion renders in a card with Discard / Try again / Use this. "Use this"
  replaces the field and persists immediately (no wait for blur). The button is
  disabled when the field is empty (nothing to rewrite).
- **Campaign Manager hint** is length-driven and always visible: empty → "say
  more" → positive once past `SUGGESTED_CHARS`. It deliberately avoids quality
  claims ("strong, specific…") from a length signal — that waits for the real
  rewrite AI.
- **Generate footer → plan tab.** Each card reports its *live* answered-state
  up (`onAnsweredChange`, fired on every keystroke) so the sticky "Generate my
  Campaign Plan" footer appears as soon as all three have content (the page
  seeds the initial state from the persisted story). The footer just links to
  `/dashboard/campaign-plan`; the actual review + confirm + generation lives on
  the plan tab (`campaign-plan/components/CampaignPlanStoryGate.tsx`), which
  shows the three answers, an "Edit my Story" link back here, and a confirm
  modal before generating.

## Related

- `app/shared/experiments/campaignStoryFlag.ts` — flag wrapper hook + key.
- `app/dashboard/shared/DashboardMenu.tsx` — sidebar entry (campaign category).
- `packages/gp-api/src/campaignStory/` — table, endpoints, service.
