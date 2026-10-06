# Serve navigation: five tabs, chat-first

Status: brainstorm, on hold. Nothing is built.

We start after two things land:

- The citizens' panel work.
- Tomer's work merging Polls into Constituent outreach.

This covers Serve only for now. Win keeps its current nav through election season so we don't confuse candidates.

## The five tabs

| Tab | What it holds |
|---|---|
| Home | Chief of Staff chat, the meeting strip and the one-in-focus card stack |
| Priorities | Your priorities, what your community is raising, and ordinances as one thing a priority can produce |
| Contacts | Constituent data and lists, including the panel's home |
| Constituent outreach | Every outreach channel and polls (Tomer's work), with poll results in the history table |
| Your page | Public profile: priorities marked public, subscribers and traffic |

The Chief of Staff composer is on every tab and knows which page you're on. My Profile and the Community forum move to the avatar menu.

## What leaves the nav

| Today | Goes to |
|---|---|
| Briefing Assistant | The meeting strip on Home, a Meetings page, and the chat |
| Community Issues | New issues become Home cards; the full list merges into Priorities |
| Ordinances | Inside a priority |
| Polls | Constituent outreach (Tomer) |
| Public Profile | Your page |

## Home

- **Card stack:** one card in focus. Act or dismiss, and the next one shows. Cards are things that changed since the last visit.
- **New users:** onboarding cards (meet your agent, fill in your profile, build your panel).
- **Meeting strip:** pinned above the stack, from about 48 hours before a meeting until it ends. It has three states:
  1. Schedule only: "Council meeting tomorrow at 7pm. Have the agenda?" with an Attach agenda button. This uses the existing agenda upload.
  2. Agenda in: "Your briefing is ready."
  3. Meeting over: the strip goes away and the after-meeting card enters the stack.
- **Meetings:** a link on Home to a full page you step into and back out of (no sidebar, back arrow, title). Upcoming meetings first, then past ones, plus "Prep for a meeting."
- **Chat:** you can ask for any briefing by name ("pull up last Tuesday's briefing").

## The meeting loop

1. **Ask card before the meeting.** Show it only when every condition holds:
   - The agenda item is a vote or action item.
   - It matches one of the official's priorities or a top community issue, and the card says which.
   - There are at least 24 hours left before the meeting.
2. **Answers show up in the briefing** as "What we heard" on that agenda item.
3. **One card after the meeting:** "How did Tuesday go?" The official fills in what was decided (for now). It then drafts a close-the-loop message in the official's voice.
4. **Close the loop.**
   - Send to the people who answered first, then optionally a wider list.
   - Post it on Your page, on the matched priority.
5. **If nobody was asked beforehand,** still offer close-the-loop when a priority-linked item was decided. Skip it when nothing on the agenda touched a priority or top issue.

That's at most two cards per meeting, plus the strip.

## The ask budget

- Priorities and meetings share one budget. Panel members rest for 30 days between asks.
- When the panel is resting, the card offers "Ask a fresh group" (a random sample with the JOIN line) instead of disappearing.

## Pre-filling "what was decided"

The official fills it in. Posted records can't pre-fill it in time for our users.

We checked 22 randomly sampled real bodies our active users sit on. Active Serve users sit on 725 councils and boards, with a median district of about 8,000 people.

- **Structured outcomes within a week: 0 of 22.** None use Legistar. The only structured votes were roll-call tables inside one town's PDF minutes, posted weeks later.
- **Minutes lag a median of about 3.5 weeks** (range 1 week to 4+ months), because most post only after the next meeting approves them. About a quarter are stale, missing, scanned or blocked to automated fetching.
- **Video is the only fast source.**
  - About 16 of 22 post video, and at least 6 within 24 hours.
  - YouTube and Granicus are the easiest to reach by machine; Facebook Live and cable-only are hard.

Plan:

1. **First version:** the official fills in what was decided right after the meeting. Never hold close-the-loop for minutes.
2. **Later: a draft from the meeting video.** Where video posts within a day, an agent drafts "what was decided" from the transcript, and the official confirms it.
3. **Later: a confirmation pass against approved minutes,** 3 to 5 weeks later. Flag anything that contradicts what was sent. CivicClerk's open API and Granicus can tell us when new minutes appear.

Nothing looks for minutes or video today. The briefing agent finds agendas by searching the web at run time and saves the link for next time.

## Build order

1. Citizens' panel work and Tomer's polls work land.
2. Nav change behind a flag: redirects for old links, and the product map updated in the same change.
3. Chief of Staff on every tab, plus the Meetings page.
4. Meeting strip and ask card.
5. Report-back for priorities, from the panel follow-up queue.
6. Meeting close-the-loop as the second use of report-back.
7. Your page rebuild.

## Measuring it

Baseline: prod, signed-in users, last 30 days. It's saved in Amplitude as "Serve nav consolidation baseline, last 30 days".

| Surface | Users | Detail |
|---|---|---|
| Chief of Staff | 52 | |
| Briefings | 31 | 18 opened a briefing, 2 downloaded one |
| Community Issues | 33 | 14 opened an issue, 3 clicked Prioritize |
| Constituent outreach | 27 | |
| Polls | 23 | |
| Ordinances | 17 | 1 opened a draft |

After launch, re-run the chart split by flag on or off.

Tracking gaps:

- Amplitude's automatic page-view event has no signed-in users, so it can't be used.
- Public profile views aren't tracked at all.

## Open

- **Video-based draft:** worth a spike once close-the-loop ships. Test it on the bodies that post to YouTube or Granicus within 24 hours.
- **Contacts and Outreach:** a lists-first merge stays a later option.
- **Win:** the same five slots later (Home, Plan, Voters, Outreach, Your page).
- **Data gap:** city, district and website are empty for active Serve users in Databricks (`int__civics_elected_official_gp_api`). This needs a fix in `gp-data-platform`.

## Account menu

The account menu is one avatar menu, shared with Win.

- **Placement:** bottom-left of the sidebar on desktop, top-right of the Home header on mobile.
- **Avatar:** the photo if there is one, otherwise initials. The `UserAvatar` component already does this.
- **One menu, not two:** today the avatar dropdown in the top bar and the account menu in the sidebar duplicate each other. Merge them.
- **Contents:**
  - Your name and photo (opens Account)
  - Switch office or campaign, using the existing org picker, for people with both Win and Serve
  - Account settings
  - Team (Win only, campaign managers)
  - Get help
  - Community forum
  - Log out
- **Name the account item "Account", not "Profile",** so it can't be confused with Your page, the public profile.
