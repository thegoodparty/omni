# Campaign Manager conversational home (prototype)

Working note for the prototype that replaces the card-based Win dashboard home with a
conversation-first home, behind a feature flag, built so the same component can serve
the Serve Chief of Staff. **Delete this file before the prototype merges to `main`.**

Branch: `claude/campaign-manager-ai-prototype-t4dgn6`.

Design source: Claude Design project `5718ad9e-b4e7-493e-8cbf-37711fc905c0`,
file `Campaign Manager.dc.html`. It cannot be read from a Claude Code web session
(`DesignSync` needs `/design-login`, which is interactive-only). Run `/design-login`
once in a local interactive session, then `DesignSync` `get_file` works.

## The goal

Today the Win home tells candidates what to do with a stack of cards. The prototype
replaces that with an open conversation the Campaign Manager starts. Same information
hierarchy and same rules as the cards, delivered conversationally, with every
recommendation ending in a microcard CTA.

Two behaviors define it:

- **First-time user.** The manager introduces itself, sketches what it can do, then
  asks the questions it needs to personalize: why you are running, what issues you
  are running on, and so on.
- **Returning user.** Every new session opens with what changed since last time, then
  clear direction on what to tackle this week. Each item carries a microcard CTA, and
  an outreach CTA opens the bottom drawer for that outreach action.

## What already exists

This is closer to a promotion than a build. The conversation is already there, it is
just docked in a drawer behind the cards.

### Frontend (packages/gp-webapp)

| Thing | Where |
| --- | --- |
| Win home route | `app/dashboard/page.tsx` → `app/dashboard/components/DashboardContent.tsx` |
| The card home to replace | `app/dashboard/campaign-manager/CampaignManagerHome.tsx` |
| The cards themselves | `ProUpgradeBanner`, `TextingSetupBanner`, `ProUpgrade3ComplianceCard`, `ProgressSection` (in `app/dashboard/components/campaignManager/`), plus `CampaignManagerTasks` and its `ManagerPromptCard` / `PersonalizeStoryCard` / `GetOnBallotCard` / `StoryReadyCard` |
| The always-on chat dock | `app/dashboard/campaign-manager/CampaignManagerChatProvider.tsx`, mounted in `DashboardLayout` via `DashboardCampaignManagerChat` |
| Chat surface and body | `app/dashboard/chief-of-staff/components/chat/ChiefOfStaffChatSurface.tsx` and `ChiefOfStaffChatBody.tsx` |
| Chat client | `app/dashboard/campaign-manager/campaignManagerChat.ts` |
| Feature flags | `app/shared/experiments/`, documented in `packages/gp-webapp/docs/feature-flags.md` |

Win and Serve already share the chat components: the Win dock imports `FooterChatBar`,
`ChiefOfStaffChatSurface`, and `ChiefOfStaffChatBody` straight out of the
`chief-of-staff/` tree. Building the new home parameterized by chat config rather than
hardcoded to Win is therefore the natural shape, not extra work.

The dock already has the pieces the FTUE needs:

- A server-seeded, resume-aware greeting.
- Starter suggestion chips typed as `ChatSuggestion { label, description, kickoff }`,
  which is close to the microcard shape already.
- One-shot hidden kickoff sentinels (`CAMPAIGN_MANAGER_START_STORY_SENTINEL`,
  `CAMPAIGN_MANAGER_PRODUCT_OVERVIEW_SENTINEL`, and a ballot kickoff) that drive a
  scripted flow without the candidate typing.

### Backend (packages/gp-api)

The `campaign_assistant` scope handler is real and substantial:
`src/chats/general/campaign-manager/campaignManager.handler.ts` (~500 lines), with its
system prompt in `campaignManagerPrompt.ts`.

`CampaignManagerContext` already carries office name, district, office level,
location, weeks to election, ballot status, filing window start and end, precomputed
days to the filing deadline, top tracker tasks, Campaign Story state, and the
generated plan's strategic landscape.

Registered tools: `web_search` (Anthropic native), `query_constituent_data` and
`describe_constituent_data` (aggregate-only Win voter mart), `get_ballot_requirements`
(BallotReady, bound to the campaign's race hash), `campaign_story`,
`describe_filter_dimensions`, `count_contacts`, and `crud_saved_filters`.

## Requested context, mapped to reality

| Requested | Status | Notes |
| --- | --- | --- |
| Onboarding answers (why running, issues) | **In context** | `story` on `CampaignManagerContext`; `campaign_story` tool reads and writes it |
| On the ballot / filed status | **In context** | `ballotStatus` from onboarding, plus `filingPeriodStart` / `filingPeriodEnd` / `daysToFilingDeadline` and the `get_ballot_requirements` tool |
| Campaign plan and its action items | **Partly in context** | `plan` (strategic landscape) and `topTasks` are there. Whether that is the full action-item set the CTAs need has not been checked |
| Know Your Opponent | **Not wired** | Backend module exists (`packages/gp-api/src/raceOpponent/`, frontend `app/dashboard/race-opponent/`) but no chat tool exposes it. Needs a new read tool. Pro-gated |
| Community issues | **Serve only, real gap** | Every endpoint in `packages/gp-api/src/communityIssues/controllers/` is bound to `@ReqElectedOffice()`. This is a backend gap for Win, not a wiring job. Scope it separately |
| Voter data questions | **In context** | `query_constituent_data` / `describe_constituent_data` / `count_contacts`, all aggregate-only with a cell-size floor |
| "What changed since last time" | **Does not exist** | Needs a digest: a last-seen timestamp plus a diff over plan, tracker, opponent, and outreach state. The single biggest new build |
| "What to tackle this week" | **Partly** | `topTasks` and `selectTopDynamicTasks` exist on both sides. Reframing them as conversational turns with CTAs is presentation work |

## The one architectural conflict

The ask is that an outreach CTA instantiates the bottom drawer for that outreach
action. Today it cannot, by design. `app/dashboard/outreach/AGENTS.md` says the hub
(`v2/OutreachHubPage.tsx`) is the only thing that mounts the channel flows, and every
task CTA elsewhere in the product deep-links to
`/dashboard/outreach?compose=text|robocall` instead:

> Linking beats mounting in place because the hub owns exactly one instance of each
> channel flow plus the gate in front of it; a second mount would duplicate both.

Two options:

1. **Deep link (matches today).** The microcard navigates via
   `util/composeOutreachHref.util.ts`. Cheap, consistent, but it leaves the
   conversation.
2. **Hoist the flows.** Lift the channel flows and their gates out of `OutreachHubPage`
   so any surface can mount one. True to the ask, but it touches the Pro and 10DLC
   compliance gates, which is not prototype-shaped work.

Recommendation: ship the prototype on option 1, and treat option 2 as its own ticket
once the conversational home has proven out.

## Proposed build

1. **Flag.** `app/shared/experiments/campaignManagerChatHomeFlag.ts`, key
   `campaign-manager-chat-home`, wrapping `useFlagOn` per the per-flag wrapper
   convention. Ships dark to prod and gets turned on per user. The flag itself must be
   created in Amplitude Experiment (dev and prod); the `amplitude-flag` skill does
   this, but the Amplitude MCP was unauthorized in the session that wrote this note.
2. **Shared component.** A `ConversationalHome` parameterized by chat config (chat
   API, scope, greeting, FTUE script, microcard set) so Win passes campaign-manager
   config and Serve can later pass chief-of-staff config with no fork.
3. **Promote chat from drawer to page.** Render `ChiefOfStaffChatBody` inline and
   full-height as the home, and suppress the footer dock on `/dashboard` when the flag
   is on so there are not two chats on screen.
4. **Microcards.** Render as a CTA row attached to an assistant message. The existing
   `ChatSuggestion` shape is the starting point; the Claude Design file defines the
   visual.
5. **Branch point.** In `DashboardContent.tsx`, flag off renders today's
   `CampaignManagerHome` unchanged.

Suggested prototype scope, chosen to keep iteration fast: frontend only, reusing the
existing `campaign_assistant` endpoints so no gp-api deploy sits in the loop, with the
FTUE script driven client-side. The session digest and the Know Your Opponent tool are
the two items that will eventually force backend work.
