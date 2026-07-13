# app/dashboard/campaign-story/

Candidate-facing "Campaign Story" page: the candidate's "why" (a RichEditor),
their "background" (a textarea), and a structured "Your Policies" editor —
capturing the narrative foundation reused across the campaign plan, stump
speech, and voter messaging.

**Only `background` is part of the story record.** The "why" and issues are
**website** fields shared with the Pro-upgrade flow:

- `why` → `Website.content.about.bio` (Quill HTML) — the same field the
  Pro-upgrade candidate profile and campaign-details `WhyRunningSection` edit.
- issues → `Website.content.about.issues` (`{ title, description }[]`).
- `background` → the `campaign_story` table (the only column the page still
  writes; `campaign_story.rewrite_count` also persists the rewrite budget).

So a why or issue authored here shows up on the Pro-upgrade flow and the public
site, and vice versa.

## Key files

| File | Role |
|------|------|
| `page.tsx` | Route entry — `candidateAccess()`, server-fetches the saved story AND the website (`fetchUserWebsite`) for the initial bio + issues, renders the client page |
| `components/CampaignStoryPage.tsx` | Layout: `FeatureFlagGuard` → `DashboardLayout`, header, intro, the why card, the background card, and the issues editor (shared `PolicyPriorities`); owns issues state + the generate-footer gate |
| `components/CampaignStoryWhyCard.tsx` | The "why" card — a `RichEditor` (toolbar hidden) bound to the website bio via `saveAboutFields({ bio })` (autosaves on blur) + Campaign Manager hint + "Help me rewrite" |
| `components/CampaignStoryCard.tsx` | The "background" card — textarea (char counter, `/100` soft suggestion, not enforced) autosaving to `campaign_story` via `PUT /v1/campaigns/mine/story` + Campaign Manager hint + "Help me rewrite" |
| `components/useStoryRewrite.ts` | Shared "Help me rewrite" logic (request, suggestion state, accept/discard, the 403 limit, analytics) used by both prompt cards |
| `components/RewriteSuggestion.tsx` | Shared presentational suggestion panel (loading/error/draft + Discard / Try again / Use this) |

## Patterns

- **Gated behind the `campaign-story` Amplitude flag** via `FeatureFlagGuard`
  (route) and `useCampaignStoryFlag()` in `DashboardMenu.tsx` (sidebar item). Flag
  key lives in `@shared/experiments/campaignStoryFlag.ts`.
- **Persistence (background).** `page.tsx` server-fetches
  `GET /v1/campaigns/mine/story` to seed the background card, which autosaves on
  blur via `PUT /v1/campaigns/mine/story`. Backed by the `campaign_story` table
  in gp-api (`src/campaignStory/`); response shape is `CampaignStory`
  (`background`) from `@goodparty_org/contracts`.
- **Persistence (why + issues).** Both reuse the website and persist via
  `saveAboutFields({ bio })` / `saveAboutFields({ issues })`
  (`dashboard/website/util/website.util.ts`), which creates the `Website` row on
  first write (no Pro gate). The why card and the issues editor (the Pro-upgrade
  `PolicyPriorities`) are both passed `hideToolbar` so the Quill fields read as
  plain text while emitting the same HTML the Pro-upgrade editor reads. Initial
  bio + issues are server-fetched in `page.tsx` via `fetchUserWebsite`.
- **"Help me rewrite"** (why + background) calls
  `POST /v1/campaigns/mine/story/rewrite` (Gemini Flash, server-side) with the
  field id + current text; gp-api pairs it with the candidate's name and a
  field-specific, non-partisan prompt. The suggestion renders in a card with
  Discard / Try again / Use this. "Use this" replaces the field and persists
  immediately (no wait for blur). The button is disabled when the field is empty
  (nothing to rewrite). The endpoint is stateless on the field text, so the why
  rewrite operates on the bio's plain text. The shared `PolicyForm` "Policy
  focus" editor has its own "Help me rewrite" too (rewrite `field: 'issue'`), so
  both the Campaign Story "Your Policies" editor and the Pro-upgrade flow get it.
- **Rewrite limit.** A per-campaign lifetime cap of 200 rewrite attempts,
  tracked in `campaign_story.rewrite_count` and enforced server-side (403). A
  lifetime attempt is refunded if the Gemini call itself fails, so infra errors
  don't burn the cap. On a **403** the card shows an "AI rewrite limit reached"
  notice and disables rewriting for the session (manual edits still allowed).
- **Rewrite analytics.** `useStoryRewrite` fires Segment events via
  `trackEvent(EVENTS.CampaignStory.*)`: `RewriteRequested` ({ field, source:
  'initial' | 'retry' }), `RewriteAccepted`, `RewriteDiscarded`, and
  `RewriteLimitReached` (403) — all carry `field`. Names live in
  `helpers/analyticsHelper.ts`.
- **Campaign Manager hint** is length-driven and always visible: empty → "say
  more" → positive once past `SUGGESTED_CHARS`. It deliberately avoids quality
  claims ("strong, specific…") from a length signal — that waits for the real
  rewrite AI.
- **Generate footer → plan tab.** Each card reports its *live* answered-state up
  (`onAnsweredChange`, fired on every keystroke); the page combines why +
  background + the issues count, so the sticky footer appears once `why` +
  `background` have content AND at least one issue exists. The footer just links
  to `/dashboard/campaign-plan`; the actual review + confirm + generation lives
  on the plan tab (`campaign-plan/components/CampaignPlanStoryGate.tsx`), which
  shows the why (from the website bio) + background (from the story) and the
  issues (from the website query), an "Edit my Story" link back here, and a
  confirm modal before generating.
- **Footer reflects a kicked-off plan.** `page.tsx` also server-fetches
  `strategyExists` (`GET /v1/campaignStrategy/mine/exists`, the same check the
  plan tab + sidebar use) and passes `planExists` to the page. When a plan
  already exists — including one the **campaign manager chat** kicked off — the
  footer reads "Your Campaign Plan is on its way." / "View my Campaign Plan"
  instead of offering to generate it again. `force-dynamic` means it re-reads on
  each navigation here, so the footer stays in sync with generation started
  elsewhere.
- **Completeness gate.** `isCampaignStoryComplete(story, hasWhy, hasIssues)`
  (`useCampaignStory.ts`) requires `hasWhy` + non-empty `background` + `hasIssues`.
  Callers source `hasWhy` from the website bio (`content.about.bio`) and
  `hasIssues` from the website issues (`content.about.issues`), not the story.
  `useCampaignStoryComplete(enabled)` (`useCampaignStoryComplete.ts`) packages
  this up — it fetches the story + website (only when `enabled`, so the non-story
  cohort never triggers the fetches) and returns `{ isComplete, isLoading,
  isError }` with the same fail-open (website error) / fail-closed (story error)
  semantics `CampaignPlanStoryGate` uses. `CampaignPlanRouter` reads it to gate
  the plan/tracker: a story-cohort user only reaches the plan once the story is
  complete, so a flag-on account that generated a plan before completing its
  story (e.g. pre-flag) is routed to the story gate instead of a tracker that can
  never populate.
- **Shared why copy.** The "why" instruction is a single constant,
  `WHY_RUNNING_PROMPT` (candidate-profile `candidateProfile.utils.ts`), reused by
  the why card here, the Pro-upgrade `CandidateProfileFields`, and the
  campaign-details `WhyRunningSection`, so the prompt reads identically wherever
  the candidate writes their why. The story stays **lenient** — the bio's 500-char
  minimum is enforced only in those other flows, not here.

## Related

- `app/shared/experiments/campaignStoryFlag.ts` — flag wrapper hook + key.
- `app/dashboard/shared/DashboardMenu.tsx` — sidebar entry (campaign category).
- `packages/gp-api/src/campaignStory/` — `campaign_story` table (`background`,
  `rewrite_count`), endpoints, rewrite service.
- `app/dashboard/profile/texting-compliance/candidate-profile/` — the shared
  `PolicyPriorities`/`PolicyForm` issues editor, the bio utils
  (`MIN_BIO_LENGTH`, `getBioError`, `getBioPlainLength`), and `WHY_RUNNING_PROMPT`.
- `app/dashboard/website/util/website.util.ts` — `saveAboutFields` /
  `getUserWebsite`; the why (bio) and issues live on `Website.content.about`.
