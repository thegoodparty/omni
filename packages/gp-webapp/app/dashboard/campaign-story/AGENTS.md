# app/dashboard/campaign-story/

**The standalone `/dashboard/campaign-story` route + "Your story" sidebar tab
exist** (restored under the `campaign-story` flag). The page
(`components/CampaignStoryPage.tsx`) renders the **onboarding** story cards
(`app/onboarding/components/StoryIntakeCard` for why/background,
`StoryIssuesCard` for the policy priorities). Unlike onboarding it's a single
editable page: one **Save** in the page title bar commits every
dirty field at once (`saveAll`), and a **Start over** at the bottom (shown once
any field has content) clears the fields in memory — Save stays the only thing
that persists, so Start over deletes nothing until the candidate Saves the empty
state. The cards get no `save` prop here (their per-field Save bar is
onboarding-only).

The `sections.ts` + `useCampaignStory*` modules are shared: `sections.ts` (which
owns the `CampaignStorySection` type + `CAMPAIGN_STORY_SECTIONS`) is read by the
plan tab's `CampaignPlanStoryGate` (`campaign-plan/components/`). The old
self-saving cards (`CampaignStoryWhyCard`, `CampaignStoryCard`,
`StoryCardActions`, `OnboardingCampaignStoryStep`) have been **deleted** —
everything now runs through the onboarding `StoryIntakeCard` / `StoryIssuesCard`.

The candidate's story is: the "why", the "background", and a structured set of
policy priorities — the narrative foundation reused across the campaign plan,
stump speech, and voter messaging.

**Only `background` is part of the story record.** The "why" and issues are
**website** fields shared with the Pro-upgrade flow:

- `why` → `Website.content.about.bio` (Quill HTML) — the same field the
  Pro-upgrade candidate profile and campaign-details `WhyRunningSection` edit.
- issues → `Website.content.about.issues` (`{ title, description }[]`).
- `background` → the `campaign_story` table (the only column written here;
  `campaign_story.rewrite_count` also persists the rewrite budget).

So a why or issue authored here shows up on the Pro-upgrade flow and the public
site, and vice versa.

## Pro-upgrade sync (no build needed)

The Pro-upgrade candidate profile asks for the "why" and policy priorities too,
which raised a concern about re-asking. It already syncs, because both surfaces
use the same storage and read path, so no backfill migration or prefill wiring
is needed:

- **why (bio) and issues:** the Pro candidate-profile step
  (`profile/texting-compliance/candidate-profile/useCandidateProfileForm.ts`)
  saves via `saveAboutFields({ bio, issues })` and seeds its form from
  `getUserWebsite()` (`Website.content.about.bio` / `.issues`), the identical
  fields the story cards write and read. A value entered in either surface
  pre-fills the other automatically, in both directions. Existing Pro users
  therefore already have their why and issues in the story.
- **background:** story-only (`campaign_story` table). The Pro flow never
  collects, stores, reads, or pre-fills it (its only `campaigns/mine/story`
  reference is the stateless `story/rewrite` AI endpoint in `PolicyForm.tsx`,
  not the background field), and by design it has no background field. So there
  is nothing to backfill or pre-fill for background; a candidate still answers
  it in onboarding or the campaign manager.

Net: the only field unique to the story is `background`; everything Pro shares
already round-trips through `Website.content.about`.

## Key files

| File | Role |
|------|------|
| `components/CampaignStoryPage.tsx` | The "Your story" dashboard page — renders the onboarding `StoryIntakeCard` (why/background) + `StoryIssuesCard` (policies); one Save commits all dirty fields, a bottom Start over clears them. Its title comes from `DashboardLayout`'s shared `navHeader` (icon + tab name from `shared/navLabels.ts`), and `StoryEditorForm`'s Save portals into that bar via `DashboardNavHeaderAction` — the feature-local `StoryHeaderBar` band (gray `bg-base-muted`, `text-xl`, sticky) is gone |
| `components/useStoryRewrite.ts` | Shared "Improve with AI" logic (request, apply-in-place, undo, the 403 limit, analytics) — used by the onboarding cards (`StoryFieldBar`) |
| `sections.ts` | Owns the `CampaignStorySection` type + `CAMPAIGN_STORY_SECTIONS` (the `background` prompt), read by the plan-tab `CampaignPlanStoryGate` |

## Patterns

- **Gated behind the `campaign-story` Amplitude flag** (`useCampaignStoryFlag()`,
  `@shared/experiments/campaignStoryFlag.ts`). No route or sidebar item reads it
  directly anymore. It now drives the onboarding step config
  (`onboardingConfig.ts` / `OnboardingFlow.tsx`), the plan tab's routing and
  "Campaign Tracker" label (`CampaignPlanRouter.tsx`, `CampaignPlanView.tsx`,
  `DashboardMenu.tsx`), and the story-completeness gate
  (`CampaignPlanStoryGate`).
- **Persistence (background).** Consumers (the onboarding story draft, the
  "Your story" page, `CampaignPlanStoryGate`) read the story client-side via
  `useCampaignStory()` (`GET /v1/campaigns/mine/story`) and write via
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
- **"Improve with AI"** (why + background) calls
  `POST /v1/campaigns/mine/story/rewrite` (Gemini Flash, server-side) with the
  field id + current text; gp-api pairs it with the candidate's name and a
  field-specific, non-partisan prompt. While it runs the button reads
  "Improving…"; on success the improved text is dropped **straight into the
  field** and persisted immediately (no suggestion panel, no wait for blur), and
  an **Undo** link appears (left of the button) that restores the pre-improvement
  text and re-saves it. Undo stays until it's clicked or the next improvement
  recaptures the baseline. The button is disabled when the field is empty
  (nothing to improve). The endpoint is stateless on the field text, so the why
  rewrite operates on the bio's plain text. The shared `PolicyForm` "Policy
  focus" editor has its own separate "Help me rewrite" (rewrite `field: 'issue'`,
  still a suggestion panel), independent of `useStoryRewrite`.
- **Rewrite limit.** A per-campaign lifetime cap of 200 rewrite attempts,
  tracked in `campaign_story.rewrite_count` and enforced server-side (403). A
  lifetime attempt is refunded if the Gemini call itself fails, so infra errors
  don't burn the cap. On a **403** the card shows an "AI rewrite limit reached"
  notice and disables rewriting for the session (manual edits still allowed).
- **Rewrite analytics.** `useStoryRewrite` fires Segment events via
  `trackEvent(EVENTS.CampaignStory.*)`: `RewriteRequested` ({ field, source:
  'initial' }), `RewriteAccepted` (fired when the improvement is auto-applied),
  `RewriteDiscarded` (fired on Undo), and `RewriteLimitReached` (403) — all carry
  `field`. Names live in `helpers/analyticsHelper.ts`.
- **Campaign Manager hint** is length-driven and always visible: empty → "say
  more" → positive once past `SUGGESTED_CHARS`. It deliberately avoids quality
  claims ("strong, specific…") from a length signal — that waits for the real
  rewrite AI.
- **Shared cards live in onboarding.** Both onboarding and the "Your story"
  dashboard page render the new-design `StoryIntakeCard` (why/background) +
  `StoryIssuesCard` (inline "Priority N" rows, no modal) from
  `app/onboarding/components/`. Onboarding is deferred (one save on the final
  step, `useOnboardingStoryDraft`); the dashboard passes each card a `save`
  (`StorySaveState`) so it persists that field on its own Save button
  (`CampaignStoryPage`). The `useStoryRewrite` hook here backs the shared
  `StoryFieldBar` and gained an `'issue'` field (+ optional `title`) for the
  policy rows. See `app/onboarding/CLAUDE.md`.
- **why persistence → Pro.** Because the why is the website bio, any writer must
  invalidate `USER_WEBSITE_QUERY_KEY` after saving or a later reader within the
  5-min `staleTime` (notably the Pro-upgrade candidate profile, which seeds its
  bio from that cache on in-app navigation) reads the pre-write snapshot and the
  why won't pre-fill. `useOnboardingStoryDraft.persist` and `CampaignStoryPage`
  both invalidate; keep that up in any new writer.
- **Plan tab review + generation.** The actual review + confirm + generation
  UI lives on the plan tab
  (`campaign-plan/components/CampaignPlanStoryGate.tsx`), which shows the why
  (from the website bio) + background (from the story) and the issues (from
  the website query), an "Open your campaign manager" / "Edit in campaign
  manager" link to `/dashboard?personalize=1` (a deep link `CampaignManagerHome`
  consumes to open the manager and auto-launch the story-intake chat flow,
  same as the manager home's own story card), and a confirm modal before
  generating.
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
  the candidate writes their why. The story stays **lenient** — the bio's
  `MIN_BIO_LENGTH` (200-char) minimum is enforced only in those other flows, not
  here. The why card has no character cap or minimum of its own (a pre-existing
  longer bio loads and edits intact).

## Related

- `app/onboarding/components/` owns the shared story cards (`StoryIntakeCard`,
  `StoryIssuesCard`, `StoryFieldBar`) used by both onboarding (deferred, one save
  on leaving the story) and the `/dashboard/campaign-story` page (single header
  Save + Start over) — see `app/onboarding/CLAUDE.md`.
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
