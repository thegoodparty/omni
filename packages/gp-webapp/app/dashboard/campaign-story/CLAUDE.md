# app/dashboard/campaign-story/

Candidate-facing "Campaign Story" page: two free-text prompts (your why, your
background) plus a structured "your issues" editor, capturing the narrative
foundation reused across the campaign plan, stump speech, and voter messaging.

**Issues are NOT part of the story record.** `why`/`background` persist to the
`campaign_story` table; the issues editor reads/writes the candidate's website
issues (`Website.content.about.issues`, `{ title, description }[]`), the same
data the Pro-upgrade candidate-profile flow edits. So an issue authored here
shows up on the Pro-upgrade flow and the public site, and vice versa.

## Key files

| File | Role |
|------|------|
| `page.tsx` | Route entry — `candidateAccess()`, server-fetches the saved story AND the website (`fetchUserWebsite`) for initial issues, renders the client page |
| `components/CampaignStoryPage.tsx` | Layout: `FeatureFlagGuard` → `DashboardLayout`, header, intro, the why/background cards, and the issues editor (shared `PolicyPriorities`); owns issues state + the generate-footer gate |
| `components/CampaignStoryCard.tsx` | One free-text prompt card (why or background) — textarea (char counter at its bottom-right, `/100` soft suggestion, not enforced) + Campaign Manager hint + "Help me rewrite" |

## Patterns

- **Gated behind the `campaign-story` Amplitude flag** via `FeatureFlagGuard`
  (route) and `useCampaignStoryFlag()` in `DashboardMenu.tsx` (sidebar item). Flag
  key lives in `@shared/experiments/campaignStoryFlag.ts`.
- **Persistence (why/background).** `page.tsx` server-fetches
  `GET /v1/campaigns/mine/story` to seed each card; each card autosaves its own
  field on blur via `PUT /v1/campaigns/mine/story` (partial body, one field).
  Backed by the `campaign_story` table in gp-api (`src/campaignStory/`);
  response shape is `CampaignStory` (`why`, `background`) from
  `@goodparty_org/contracts`.
- **Persistence (issues).** The issues editor reuses the Pro-upgrade
  `PolicyPriorities` component and persists every change to the website via
  `saveAboutFields({ issues })` (`dashboard/website/util/website.util.ts`),
  which creates the `Website` row on first write (no Pro gate). The editor is
  passed `hideToolbar` so the Quill description field reads as plain text while
  still emitting the same HTML the Pro-upgrade editor reads. Initial issues are
  server-fetched in `page.tsx` via `fetchUserWebsite`.
- **"Help me rewrite"** (why/background only) calls
  `POST /v1/campaigns/mine/story/rewrite` (Gemini Flash, server-side) with the
  section id + current text; gp-api pairs it with the candidate's name and a
  section-specific, non-partisan prompt. The suggestion renders in a card with
  Discard / Try again / Use this. "Use this" replaces the field and persists
  immediately (no wait for blur). The button is disabled when the field is empty
  (nothing to rewrite). The issues editor has no rewrite affordance.
- **Rewrite limit.** A per-campaign lifetime cap of 200 rewrite attempts,
  tracked in `campaign_story.rewrite_count` and enforced server-side (403). A
  lifetime attempt is refunded if the Gemini call itself fails, so infra errors
  don't burn the cap. On a **403** the card shows an "AI rewrite limit reached"
  notice and disables rewriting for the session (manual edits still allowed).
- **Rewrite analytics.** `CampaignStoryCard` fires Segment events via
  `trackEvent(EVENTS.CampaignStory.*)`: `RewriteRequested` ({ field, source:
  'initial' | 'retry' }), `RewriteAccepted`, `RewriteDiscarded`, and
  `RewriteLimitReached` (403) — all carry `field`. Names live in
  `helpers/analyticsHelper.ts`.
- **Campaign Manager hint** is length-driven and always visible: empty → "say
  more" → positive once past `SUGGESTED_CHARS`. It deliberately avoids quality
  claims ("strong, specific…") from a length signal — that waits for the real
  rewrite AI.
- **Generate footer → plan tab.** Each free-text card reports its *live*
  answered-state up (`onAnsweredChange`, fired on every keystroke); the page
  combines that with the issues count, so the sticky "Generate my Campaign Plan"
  footer appears once `why` + `background` have content AND at least one issue
  exists. The footer just links to `/dashboard/campaign-plan`; the actual review
  + confirm + generation lives on the plan tab
  (`campaign-plan/components/CampaignPlanStoryGate.tsx`), which shows why +
  background (from the story) and the issues (from the website query), an "Edit
  my Story" link back here, and a confirm modal before generating.
- **Completeness gate.** `isCampaignStoryComplete(story, hasIssues)`
  (`useCampaignStory.ts`) requires non-empty `why` + `background` AND
  `hasIssues`. Callers source `hasIssues` from the website issues
  (`content.about.issues`), not the story.

## Related

- `app/shared/experiments/campaignStoryFlag.ts` — flag wrapper hook + key.
- `app/dashboard/shared/DashboardMenu.tsx` — sidebar entry (campaign category).
- `packages/gp-api/src/campaignStory/` — `campaign_story` table (`why`,
  `background`), endpoints, rewrite service.
- `app/dashboard/profile/texting-compliance/candidate-profile/` — the shared
  `PolicyPriorities`/`PolicyForm` issues editor (Pro-upgrade flow).
- `app/dashboard/website/util/website.util.ts` — `saveAboutFields` /
  `getUserWebsite`; issues live on `Website.content.about.issues`.
