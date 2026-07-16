# app/dashboard/campaign-story/

**The standalone `/dashboard/campaign-story` route and its sidebar tab were
removed.** The why/background/issues cards and the `sections.ts` /
`useCampaignStory*` modules in this directory now exist purely as reusable
pieces: composed into onboarding by
`app/onboarding/components/OnboardingCampaignStoryStep.tsx`, and read by the
plan tab's `CampaignPlanStoryGate` (`campaign-plan/components/`). A candidate
edits their story during onboarding or via the campaign manager, not a
dedicated dashboard tab.

Candidate-facing "Campaign Story" cards: the candidate's "why" (a RichEditor),
their "background" (a textarea), and a structured "Your Policies" editor —
capturing the narrative foundation reused across the campaign plan, stump
speech, and voter messaging.

**Only `background` is part of the story record.** The "why" and issues are
**website** fields shared with the Pro-upgrade flow:

- `why` → `Website.content.about.bio` (Quill HTML) — the same field the
  Pro-upgrade candidate profile and campaign-details `WhyRunningSection` edit.
- issues → `Website.content.about.issues` (`{ title, description }[]`).
- `background` → the `campaign_story` table (the only column written here;
  `campaign_story.rewrite_count` also persists the rewrite budget).

So a why or issue authored here shows up on the Pro-upgrade flow and the public
site, and vice versa.

## Key files

| File | Role |
|------|------|
| `components/CampaignStoryWhyCard.tsx` | The "why" card — a `RichEditor` (toolbar hidden) bound to the website bio via `saveAboutFields({ bio })` (autosaves on blur) + Campaign Manager hint + "Help me rewrite" |
| `components/CampaignStoryCard.tsx` | The "background" card — textarea (char counter, `/100` soft suggestion, not enforced) autosaving to `campaign_story` via `PUT /v1/campaigns/mine/story` + Campaign Manager hint + "Help me rewrite" |
| `components/useStoryRewrite.ts` | Shared "Help me rewrite" logic (request, suggestion state, accept/discard, the 403 limit, analytics) used by both prompt cards |
| `components/RewriteSuggestion.tsx` | Shared presentational suggestion panel (loading/error/draft + Discard / Try again / Use this) |

## Patterns

- **Gated behind the `campaign-story` Amplitude flag** (`useCampaignStoryFlag()`,
  `@shared/experiments/campaignStoryFlag.ts`). No route or sidebar item reads it
  directly anymore. It now drives the onboarding step config
  (`onboardingConfig.ts` / `OnboardingFlow.tsx`), the plan tab's routing and
  "Campaign Tracker" label (`CampaignPlanRouter.tsx`, `CampaignPlanView.tsx`,
  `DashboardMenu.tsx`), and the story-completeness gate
  (`CampaignPlanStoryGate`).
- **Persistence (background).** Consumers (`OnboardingCampaignStoryStep`,
  `CampaignPlanStoryGate`) read the story client-side via `useCampaignStory()`
  (`GET /v1/campaigns/mine/story`); the background card autosaves on blur via
  `PUT /v1/campaigns/mine/story`. Backed by the `campaign_story` table in
  gp-api (`src/campaignStory/`); response shape is `CampaignStory`
  (`background`) from `@goodparty_org/contracts`.
- **Persistence (why + issues).** Both reuse the website and persist via
  `saveAboutFields({ bio })` / `saveAboutFields({ issues })`
  (`dashboard/website/util/website.util.ts`), which creates the `Website` row on
  first write (no Pro gate). The why card and the issues editor (the Pro-upgrade
  `PolicyPriorities`) are both passed `hideToolbar` so the Quill fields read as
  plain text while emitting the same HTML the Pro-upgrade editor reads. Initial
  bio + issues are fetched client-side (`getUserWebsite`) by whichever consumer
  mounts the cards (onboarding, the plan-tab gate).
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
- **Onboarding completion → plan generation.** Each card reports its *live*
  answered-state up (`onAnsweredChange`, fired on every keystroke);
  `OnboardingCampaignStoryStep` combines why + background + the issues count
  into a single `onCompleteChange(complete)` callback. `OnboardingFlow.tsx`
  owns the step's footer copy and fires plan + tracker generation once the
  candidate completes (or explicitly skips) the story step - see the
  `campaign-story` branches in `OnboardingFlow.tsx`.
- **Plan tab review + generation.** The actual review + confirm + generation
  UI lives on the plan tab
  (`campaign-plan/components/CampaignPlanStoryGate.tsx`), which shows the why
  (from the website bio) + background (from the story) and the issues (from
  the website query), an "Open your campaign manager" / "Edit in campaign
  manager" link to `/dashboard`, and a confirm modal before generating.
  Whether a plan already exists (including one the **campaign manager chat**
  kicked off) is decided by `campaign-plan/page.tsx` (`GET
  /v1/campaignStrategy/mine/exists`) and threaded through
  `CampaignPlanRouter.tsx`, not by anything in this directory.
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

- `app/onboarding/components/OnboardingCampaignStoryStep.tsx` composes the same
  why/background/issues cards into the onboarding flow as a skippable step,
  firing plan + tracker generation on completion.
- `app/shared/experiments/campaignStoryFlag.ts` — flag wrapper hook + key.
- `app/dashboard/shared/DashboardMenu.tsx` — reads the flag to label the plan
  tab "Campaign Tracker" for the story cohort. No dedicated sidebar entry for
  Campaign Story exists anymore.
- `app/dashboard/campaign-plan/components/CampaignPlanStoryGate.tsx` — reads
  the story + website to gate/preview the plan tab before generation.
- `packages/gp-api/src/campaignStory/` — `campaign_story` table (`background`,
  `rewrite_count`), endpoints, rewrite service.
- `app/dashboard/profile/texting-compliance/candidate-profile/` — the shared
  `PolicyPriorities`/`PolicyForm` issues editor, the bio utils
  (`MIN_BIO_LENGTH`, `getBioError`, `getBioPlainLength`), and `WHY_RUNNING_PROMPT`.
- `app/dashboard/website/util/website.util.ts` — `saveAboutFields` /
  `getUserWebsite`; the why (bio) and issues live on `Website.content.about`.
