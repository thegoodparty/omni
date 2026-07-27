# app/onboarding/

Post-signup onboarding flow. New users land here after registration to pick the office they're running for, fill in basic campaign info, and reach a "complete" state that hands off to the dashboard.

## Key files

| File | Role |
|------|------|
| `page.tsx` | Route entry — redirects to first step |
| `[slug]/[step]/` | Dynamic route — `slug` = section, `step` = step within section |
| `onboarding.consts.ts` | Step IDs (`REGISTRATION`, `STEP_1`, `STEP_2`, `STEP_3`, `COMPLETE`) |
| `components/onboardingConfig.ts` | Step definitions / order — single source for what each step renders |
| `components/OnboardingFlow.tsx` | Top-level controller — current step, navigation |
| `components/OfficeSelectionStep.tsx` + `ManualOfficeEntryStep.tsx` | Office-selection UX (search + manual fallback) |
| `components/onboardingHelpers.ts`, `onboardingTypes.ts` | Pure helpers + types |
| `shared/` | Layout, stepper, modal, ajax helpers |
| `office-selection/` | Office-selection page bits used inside the flow |

## Patterns

- **Step-driven flow**: each step is config-defined in `onboardingConfig.ts`. To add a step, add it to the config — `OnboardingFlow` picks it up. Don't add new routes by hand.
- **Reset scroll** on step change — handled by the layout per the root CLAUDE.md navigation rule.
- **Two office-selection paths**: search (`OfficeSelectionStep`) and manual entry (`ManualOfficeEntryStep`). Manual is the fallback when search fails — keep both.
- **Campaign story = three flag-gated steps** (`campaign-story-why` → `-background` → `-issues`, `STORY_STEP_IDS` in `onboardingConfig.ts`), injected only for the `campaign-story` cohort. Why/Background render the new-design `StoryIntakeCard`; the issues step renders `StoryIssuesCard` — an inline list of `StoryIssueRow`s (title + description + a shared `StoryFieldBar` with record + "Improve with AI"), no modal. Controlled + deferred: the three answers live in one in-memory draft (`useOnboardingStoryDraft`) and persist when **leaving the story** (the final issues step, via either Continue or Skip), writing **only the answered/non-empty fields** so a skipped question never clobbers an existing answer. **Each question is individually skippable** — Continue and Skip both move one step (Skip = "skip this one"). **Continue requires content on every story step** (`storyStepEmpty` in `OnboardingFlow.tsx`: non-empty why/background text, ≥1 policy on issues); an empty field can only be passed with **Skip**, which persists nothing and so preserves any existing saved value (Continue would otherwise write the empty field and clear a returning candidate's data). **Back from the pledge returns to the first unanswered story step** (`firstUnansweredStoryStepId`). Continue is also disabled while a field is mid-dictation (`storyDictationActive`, lifted via `useReportDictationActive`) so advancing can't snapshot before a transcript lands. **Plan generation fires only when all three are answered** (`storyDraft.isComplete`) on leaving the story → `prewarmStrategicLandscape()`. Analytics are **per step** (`STORY_STEP_ANALYTICS` in `OnboardingFlow.tsx`): each step fires `Onboarding V2 - {Why Are You Running | What's Your Background | What Issues Do You Want To Solve} Viewed` on entry and `… Completed` when Continued; a Skip fires the single `Onboarding V2 - Onboarding Skipped` event with a `step` property naming the skipped step. Each step shows the standard chrome (page h1 + description + "Why we ask" aside); copy lives in `storyStepCopy.ts`. The same cards back the standalone `/dashboard/campaign-story` page (single top Save + Start over — see `app/dashboard/campaign-story/CLAUDE.md`).
- **Dictation record states** (`StoryFieldBar`): the red stop button + "● Listening…" appear the instant the mic is tapped (keyed off `dictation.active`, i.e. requesting_mic/connecting/recording — no wait for the socket's `ready`). Tapping stop enters `stopping`, shown as "◌ Transcribing…" while the server flushes the trailing final transcript. The gp-api gateway (`speech/ws/speechToText.gateway.ts`) drains the Transcribe stream on client-stop (ends the audio input and waits for AWS's final results) rather than aborting mid-utterance, so the last words aren't dropped.

## Gotchas

- `[slug]/[step]/` route is dynamic; URLs look like `/onboarding/onboarding-1/...`. Don't link to `step` numerically — go through the constants.
- Tests exist for the office-selection steps — run them when changing office logic (`OfficeSelectionStep.test.tsx`, `ManualOfficeEntryStep.test.tsx`, `OnboardingFlow.test.tsx`).
- Versioning helper lives at `shared/useVersions.ts` and returns a `useQuery` result (`{ data, error, isPending, ... }`). Consumers must handle the error and pending states — the previous mount-time `useEffect` fetch silently swallowed failures.

## Related

- `app/post-auth-redirect/` — decides whether to send users into onboarding vs dashboard.
- `helpers/resolvePostAuthRedirectPath.util.ts` — same logic, server side.
- **Adding analytics to a step or the funnel** — fire events per the `instrument-analytics-event` skill (repo root `.claude/skills/instrument-analytics-event/SKILL.md`).
