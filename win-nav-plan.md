# Win navigation: five tabs, chat-first

Status: decided in outline, nothing built. This ships after the November general, not during election season.

Five tabs, with the Campaign Manager at the center. Candidates have voters, an election and a campaign.

## The five tabs

| Tab | What it holds |
|---|---|
| Home | Campaign Manager chat, the countdown strip and the card stack |
| Plan | The whole campaign: timeline, tasks and Your race |
| Voters | Voter data and lists; the upsell for non-Pro users |
| Voter outreach | Every outreach channel, including door knocking |
| Your page | Your story and public profile |

The Campaign Manager composer is on every tab and knows which page you're on. This waits for the Campaign Manager and Chief of Staff merge, which lands today.

## Decisions

### Home

- **Card stack:** one card in focus. Act or dismiss, and the next one shows. It shows what's next, pulled from the plan.
- **Pinned strip:** shows the next hard date with a countdown, like "12 days until early voting starts" or "3 days until your filing window closes". It says what to do about it when there's something to do. Dates are plain text with a calendar icon, in warning color only when close.
- **Opponent cards:** new opponent activity shows up here as cards.

### Plan

- **The whole campaign:** the full timeline, what's done and what's ahead. Home is what's next; Plan is everything.
- **Your story is one of the first tasks.** A candidate needs it to announce their run.
- **Your race:** the Know your opponent research lives here as a section.
- **Opponent monitoring (new):** re-run the opponent research about weekly. Today it runs once. Two sources:
  - news searches for anything notable the opponent has done
  - for incumbents, their voting record, using the meeting and agenda logic that briefings already use

### Votes needed to win (the campaign's main number)

The headline metric moves from outreach counts to likely votes. Five voters reached is one likely vote, so the win number and the goal use the same unit.

- **Home:** the strip carries the race's two clocks on one line: days left and votes. For example, "21 days to election day. 412 of 1,850 likely votes."
- **Plan:** the full breakdown.
  - weekly vote targets, from the existing 12-week schedule
  - how much each channel contributed
  - how the win number is calculated, using the existing seat-aware explanation
- **Voter outreach:** each send shows what it adds before and after it goes out. For example, "This text reaches 2,000 voters, about 400 likely votes."

Decided:

1. **Every attempt counts as reached:** sent texts, knocked doors and dialed calls.
2. **Count unique voters, not touches.** Reaching the same voter again adds nothing.
3. **One ratio everywhere:** 5 voters reached is 1 likely vote, for every channel.
4. **Label it "likely votes", with an info icon** that explains the math. Never "votes won". The info text says what counts: "Counts texts, calls and doors to voters on your lists." Social posts aren't counted, as today.

### Voters

- **Pro users:** full data, lists, downloads and sends.
- **Non-Pro users:** the tab is the upsell. They see district totals, can build and slice lists, and see list counts. They can't download or send to a list. That shows what our data can do before they pay.

### Voter outreach

No change to the tab itself.

### Your page

How voters see you, all in one place:

- Your story
- Public profile
- What was the website. The website builder is deprecated, so we remove it, and its route and leftover pieces go.

### Account menu

The same avatar menu as Serve:

- **Placement:** bottom-left of the sidebar on desktop, top-right on mobile.
- **Avatar:** the photo if there is one, otherwise initials.
- **Contents:** Account, switch campaign or office, Account settings, Team (campaign managers only), Get help, Community forum, Log out.
- **Merge the two menus we have today** (the top-bar dropdown and the sidebar menu) into one.
- **Volunteers** get a minimal version: Account, Get help, Log out.

### Know your opponent upsell

The research moves into Plan, so the tab's locked-view upsell goes with it: Your race shows the locked view for non-Pro users. The Voters tab remains the main upsell.

### Election phases

- **The tabs never change by phase.** Only what's in them changes: the plan resets after the primary, and the strip moves to the next date.
- **Winning:** once we know a candidate won, we prompt them to move to Serve. We never move them automatically. We know they won when:
  - they tell us, or
  - an admin update or DDHQ data confirms it.
- **The move goes through elected-official onboarding.** That's already planned.

### Team members

- **Campaign managers** see all five tabs.
- **Volunteers** keep today's single-page view of their assigned outreach.

## Things to watch

- **Lists for non-Pro users:** building a list runs a real voter-data query. Two risks:
  - Show counts, plus the existing blurred preview, never readable rows, so voter records can't be copied out without paying.
  - Free users can run as many of these queries as they like. Watch warehouse cost, and add a rate limit if it climbs.
- **Weekly opponent monitoring is new recurring spend** for every Pro campaign with a named opponent. Price one run before choosing weekly versus every other week. Only surface a card when something notable comes back.
- **Removing the website** needs a check first: are any live candidate sites still served from it, and do they need to be redirected to Your page?

## Usage baseline

Prod, signed-in users, last 30 days. Saved in Amplitude as "Win nav consolidation baseline, last 30 days".

| Surface | Users |
|---|---|
| Home | 1,034 |
| Voter outreach | 623 |
| Campaign plan | 582 |
| Voter data (contacts) | 523 (includes a few Serve users) |
| Your story | 377 |
| Pro upgrade page | 351 |
| Know your opponent | 341 |
| Door knocking | 263 |
| Website | 7 |
| Public profile | not tracked |

## Timing

- **After the November general,** not during election season.
- **New cohorts first:** candidates signing up for 2027 races get the new nav, then existing users move over after their election.
- **Behind a flag:** redirects for old links, and the product map updated in the same change.

## Build order

1. Campaign Manager and Chief of Staff merge (today).
2. The elected-official (Serve) version ships first.
3. Win nav behind a flag: Your story moves to Your page, Know your opponent folds into Plan, website removed.
4. Countdown strip.
5. Non-Pro list building in Voters.
6. Prompt winners to move to Serve.
7. Weekly opponent monitoring and Home opponent cards.
