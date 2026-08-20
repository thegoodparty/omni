# Door knocking: where our build differs from the prototype

This compares the shipped door-knocking feature against the Lovable prototype
(`Remix of Door Knocking - 1 Page Self-Serve`), screen by screen, and sorts every
difference into one of three piles:

- **Deliberate** — someone decided to depart from the prototype, and wrote down
  why. These are listed below for product to confirm or overturn. Nothing here
  has been changed.
- **Accidental** — the prototype had it, we lost it or never built it, and no
  decision is recorded. These have been fixed in this branch; they are listed at
  the end so you can see what moved.
- **Blocked** — real gaps that sit in files three other pull requests are
  currently editing. Listed with enough detail for a follow-up to act on.

Each deliberate item below is a decision you can make without reading code: what
the prototype does, what we do, and what it costs either way. The engineering
evidence (a quote from the feature's decision register, `AGENTS.md`, or from a
comment in the code itself) is included so you can see the difference was
argued rather than forgotten.

One theme runs through most of them. **The prototype ran on 1,500 rows of
invented data in which a household, a door and a voter were the same row**
(`doorKnocking.ts` line 186), so every count agreed with every other count by
construction. Live, they are three quantities that disagree routinely: a stop is
a place the route visits, a door is an address, a person is a targeted voter, and
a block of flats is one stop, many doors, more people. A lot of what reads as us
"removing" something from the prototype is us refusing to print a number that
would be wrong.

---

## Decisions for product

### 1. A saved list's detail sheet has no progress bar

**Prototype:** a "Progress" card near the top of the list detail sheet — `40 of
68 · 59%` with a filled bar underneath.

**Ours:** the same quantity as a plain stat in the overview grid, labelled
**People logged**, reading `40 of 120 · 33%`. No bar.

**Evidence it was deliberate** — `AGENTS.md` line 89:

> **No progress bar was added.** The sheet's people-logged stat already exists
> and is worded per the "nothing says reached" note; a bar reading "40%
> complete" against a denominator of knockable people is the same
> credit-for-conversations-never-had failure in a shape that's harder to argue
> with.

**The reasoning.** A bar reads as "how much of this list is done". The number
behind it is doors where _something_ was written down — including "not home",
"inaccessible" and "refused". A canvasser who knocked forty doors and spoke to
nobody would see a bar most of the way across. The team's judgement was that the
text version (`40 of 120 · 33%`, under the word _logged_) makes the same
information available without the bar's implicit claim of completion.

**Worth knowing before you decide:** the prototype's bar can't be ported
literally, because the two ends of its fraction are the same object there and
two different objects here. Its progress reads `knocked / households`
(`ListDetailsSheet.tsx` lines 226–230), where "households" is simply the number
of rows in the list and "knocked" is how many of those rows were marked reached
(`DoorKnocking.tsx` lines 2659–2664) — one row, one household, one voter. Our
list of 68 doors holds 120 targeted people, and the two numbers move
independently. Copying the bar without choosing a side lands on
people-logged over doors, which can read past 100%.

**Recommendation:** if product wants the bar back, ask for it over the _same_
denominator the stat already uses (knockable people) and keep the word "logged"
on it. That is a small change, and it is the one to ask for. What we should not
do is copy the prototype's fraction across, because it does not mean the same
thing on our data.

**Also worth knowing:** the walk view — the screen a canvasser actually looks at
while walking — **does** have a progress bar, and always has: an "In this list"
card with a `12/40 logged` badge and a filled bar beneath it (`WalkView.tsx`
lines 342–366). So the missing bar is only on the planning surface, not in the
field.

---

### 2. Nothing in our build says a voter was "reached"

**Prototype:** the walk view badge reads `12/40 reached`; the detail sheet
describes the same figure as progress.

**Ours:** every one of those surfaces says **logged**.

**Evidence** — `AGENTS.md` line 39:

> **`WalkView` says "logged", not "reached".** `not_home`, `inaccessible` and
> `refused` all satisfy the `knockStatus !== 'unknown'` predicate the progress
> bar counts, so a canvasser who knocked forty doors and spoke to nobody used to
> read "40/40 reached" — a claim about conversations that never happened.

**Cost of keeping ours:** "logged" is a slightly colder word than "reached".

**Cost of reverting:** the number would overstate contact. Campaigns report
these figures upward.

**Recommendation:** keep ours.

---

### 3. Counts on an unknocked list read "About 68 doors", not "68 doors"

**Prototype:** exact counts everywhere — `68 households`, `213 people`.

**Ours:** before a list is knocked, both the map rail and the detail sheet say
`About 68` and carry a sentence explaining the hedge. After a list is knocked,
the counts are exact and unhedged.

**Evidence** — `AGENTS.md` line 46:

> **The rail's list count is "About N", and the softening is not about
> arithmetic.** [...] It is softened because it is a **superset of who gets
> knocked**: filters with no pack bucket don't narrow it at all [...] then drops
> do-not-knock and not-a-voter residents.

**The reasoning.** The map preview is built from a compressed snapshot of the
district that can't represent every filter a list applies (age 65+ is the live
example). The real filtering happens when the list is knocked. So the preview
number is always equal to or larger than the number of doors that get walked. We
say so rather than printing a precise-looking figure that will shrink later.

**Recommendation:** keep. The alternative is a candidate watching a "68-door
list" turn into 51 doors with no explanation.

---

### 4. The audience breakdown covers party and age only

**Prototype:** four groups — support, party, age and **top issues** — plus a
"Demographic highlights" summary ("62% Democrat", "31% aged 35–50").

**Ours:** party and age, as labelled bars with counts and percentages.

**Evidence** — `AGENTS.md` line 89 and `audienceMix.ts` lines 12–18:

> The prototype's third and fourth groups have no honest equivalent here. "Top
> issues" is not a fact this product holds about a voter — no pack dim, no route
> field, no column. Its "support" breakdown is the landing rail's seven
> canvass-status chips [...] reporting the same seven numbers again in a second
> visual form on a surface opened from that rail is how two presentations of one
> quantity start disagreeing.

**Plain version.** _Top issues_ was invented data in the prototype — we hold no
issue preference per voter, from any source, so the group could only ever be
empty or fabricated. _Support_ is already on screen as the seven coloured status
chips on the map rail, one click away; showing it twice invites the two to
disagree. Party and age are shown because they are the only two facts that
survive a list being knocked — every other dimension exists in the map snapshot
but not in a knocked route, so a wider breakdown would empty itself as a reward
for walking the list.

**Recommendation:** keep. If product wants issue-level targeting, that is a data
acquisition project, not a UI fix.

---

### 5. A door nobody has visited reads "Support unknown", not "Not visited"

**Prototype:** two separate states — _Not visited_ (grey, never knocked) and
_Support unknown_ (answered but wouldn't say). Both labels are in
`VoterPanel.tsx` lines 1086–1109, picked apart by whether the door has any
history.

**Ours:** one state, **Support unknown**, covering both.

**Evidence** — `statusPresentation.ts` lines 11–13:

> `'unknown'` is not "never knocked" — it also covers answered-but-unsure
> (`deriveKnockStatus`), so the label matches the filter vocabulary.

**The reasoning.** The status a door carries is computed on the server, and it
deliberately collapses "answered but unsure" back into unknown so that the door
stays worth knocking again. The label follows the data. It also matches the
vocabulary of the contact filters in the CRM, so a list filtered on "support
unknown" contains exactly the people the map shades that colour.

**This is the most user-visible item on this list that I'd flag for a second
look.** A candidate opening a brand-new list sees every door labelled "Support
unknown", which is true but reads oddly before anyone has knocked anything. The
per-door activity feed distinguishes the two cases (a never-visited door has no
history), and paper carries a "Last contact" line for the same reason — so the
information exists, just not in the one-word label.

**Recommendation:** worth a product decision. Splitting the label is possible
without touching the underlying data (the door's history already tells us which
case it is), but it would put a word on screen that no filter in Contacts
matches.

---

### 6. Age groups are 18–25 / 25–35 / 35–50 / 50+, not the prototype's

**Prototype:** 18–34, 35–50, 51–64, 65+.

**Ours:** 18–25, 25–35, 35–50, 50+ in the audience breakdown.

**Evidence** — `audienceMix.ts` lines 33–38: the buckets mirror the server's own
encoding "bound for bound", duplicated deliberately, "but the two **MUST** agree,
or knocking a list would silently re-shape its own age breakdown while the
audience behind it never moved."

**Note:** the age _filter_ offered when building a list uses the newer ranges
(18–24, 25–34, 35–49, 50–64, 65+) because those are the CRM's. So the breakdown
groups and the filter groups genuinely do not line up. That is a real wart, and
fixing it means changing how the map snapshot is encoded on the server — not a
UI change.

**Recommendation:** keep for now; log as data-platform work if product cares.

---

### 7. Stop numbers appear on the map and on paper, but not in lists

**Prototype:** every list row is numbered 1, 2, 3…

**Ours:** numbered on the map pins and on the printed walk sheet; no numerals in
any on-screen list (walk view rows, the detail sheet's door roster, the draw
step's door list).

**Evidence** — `AGENTS.md` line 42:

> **Stop numbering is map-and-paper only.** [...] the Aug 14 walkthrough asked
> for them out. The list isn't walked top-to-bottom [...] so a numbered row
> implied a step order nothing holds them to.

**Recommendation:** keep — this came out of a walkthrough with users.

---

### 8. Delete is shown greyed-out with a reason; Edit disappears

**Prototype:** a "…" menu on each list card holding Delete.

**Ours:** Delete is a button on the list row _and_ in the detail sheet. On a list
that has been knocked it renders disabled with the sentence "this list has
already been knocked…" beside it. Rename/recolour, by contrast, is hidden
entirely once a list is knocked.

**Evidence** — `AGENTS.md` line 87:

> It used to render only when `!liveTurf.locked`, which is how the feature got
> reported as **missing entirely**: a candidate whose lists were all knocked
> found no Delete anywhere [...] Note this makes delete and **edit** diverge
> deliberately: edit stays hidden because renaming a locked list is a limitation
> nobody goes looking for, while delete's absence was the actual bug report.

**Consequence worth knowing:** a knocked list cannot be renamed, so a typo in a
list name outlives the walk. Relaxing that is a backend change (the same endpoint
also accepts the polygon, which must not move after a route is bought).

**Recommendation:** keep. Flag the rename limitation if candidates complain.

---

### 9. The list-building flow never shows two different totals side by side

**Prototype:** the create flow shows counts freely as you filter and draw.

**Ours:** the filter step shows a district-wide count and says so in the label;
the draw step shows only the count inside the shape you have drawn. The two are
never on screen together.

**Evidence** — `AGENTS.md` line 37:

> **Two denominators live in the create flow — never mix them in one sentence.**
> [...] These were once rendered side by side, which put a district-wide
> household count next to an in-polygon door count at the moment of commitment.

**Recommendation:** keep.

---

### 10. You can't see street addresses until a list is knocked

**Prototype:** addresses are visible everywhere, including while drawing.

**Ours:** while drawing and on an unknocked saved list, we list the doors as
anonymous rows and say "Street addresses arrive with the route, once you knock
this list." After knocking, the detail sheet lists every door by address.

**Evidence** — `AGENTS.md` line 88: the map snapshot "is `positions`, two index
arrays and demographic byte planes, carrying no name and no address at any
price".

**Plain version:** the fast map layer physically does not contain addresses;
reading them is the paid routing call that "Knock" makes. The prototype could
skip this because its data was a spreadsheet loaded into the browser.

**Recommendation:** keep — there is no version of this we could build differently
without paying for routing on every shape someone drags.

---

## Where the prototype is arguably wrong, and we should not copy it

Three items above (1, 2 and 3) are in this category too. Two more:

### A. Per-list "N / M doors knocked" on the map rail — correct instinct, wrong mechanism

**Prototype:** each saved list card in the rail carries a small label,
`8 / 24 doors knocked`, plus a row of stats (households, people, estimated
time) with icons.

**Ours:** the rail row shows a colour swatch, the list name, a hide toggle, and
the Details / Knock / PDF / Delete controls. No numbers at all.

This is genuine missing information and I would have restored it, except that
**we cannot compute it in the browser without paying for it**. The list endpoint
returns each list's name, colour, shape and whether it has been knocked — no
counts. Getting "8 of 24" for a rail of a dozen lists would mean either a dozen
route fetches — the heaviest read in the feature, one per list, each returning
every door with its residents and history — or a dozen full passes over the
district snapshot, on the first screen a candidate lands on.

**Recommendation:** worth doing, as a small backend change — add `doorCount`,
`peopleCount` and `loggedCount` to the list endpoint, computed server-side where
the numbers already live. Then the rail row can carry the prototype's label
honestly. I have not attempted a client-side approximation; a rail that shows
different numbers than the detail sheet for the same list is worse than a rail
that shows none.

### B. The prototype's walk-view progress bar is segmented by outcome

Its bar is five coloured segments (supporter green, non-supporter crimson, not
home orange, inaccessible purple, refused slate). Ours is a single bar with the
seven per-status counts listed underneath it.

The prototype's version is prettier and says less: five segments over a
denominator of _everyone in the list_ means the bar is mostly empty at the start
of a walk and the segments are too thin to read at typical list sizes. Ours puts
the same five numbers below the bar in words.

**Recommendation:** a design call, not a bug. Listed in the blocked section below
because that file is being edited by another pull request right now.

---

## What was accidental, and has been fixed in this branch

### 1. The detail sheet's overview stats had lost their icons

The prototype's overview is a grid of six metric cards, each with an icon: a
house for households, people for people, a clock for time, a car or footprints
for route type, a calendar for the created date, a tick for progress. Ours was
six unadorned label-and-number pairs — six numbers in a two-column grid told
apart only by reading their labels.

Restored, using the design system's own icon set rather than the prototype's:
a door for **Doors** (we count doors, not households — that distinction is
load-bearing here), people for **People**, a clock for **Travel time** /
**Knocking time**, a pin for **Route type**, a calendar for **Created**, a tick
for **People logged**. The icons are marked decorative so screen readers read the
label, not the glyph.

_This is the "no emojis on overview components" report._

### 2. Applied filters were an undifferentiated wall of pills

The prototype groups a list's filters under the question each one answers —
Party: Democrat / Age: 35–49 / Veteran Status: Yes. Ours rendered every selection
as one flat run of pills.

That is legible for "Democrat" and meaningless for "Unknown", which is an option
on **eleven** of these filters, and for "Yes", which is on four. A list filtered
to veterans with an unknown homeowner flag rendered as `Yes  Unknown` and
identified neither. The pills are now grouped under their field, in the same
order and with the same headings the list-building flow uses, so a candidate
reads their list back in the shape they picked it.

### 3. The saved-lists rail didn't say what tapping a list does

Tapping a list's **name** is what focuses the map on it and rescopes the voter
count and the seven status chips below. Details, Knock and the hide toggle are
labelled buttons; the name is just a name, and nothing said it was a target. The
prototype's rail carries the line "Tap a list to highlight it on the map, or
Knock to start at the first door." — restored, on the populated rail only (the
empty state already explains how to make a first list).

All three are covered by new tests.

---

## Queued — blocked on in-flight pull requests

These are real differences in files that PR #1327, PR #1340 and one live editing
session are currently holding. Nothing below has been touched. A follow-up can
act on them directly.

**`PersonSheet.tsx`** (blocked on #1327)

1. **Section headers carry no icon.** The prototype's door panel is a stack of
   cards, each pairing its title with a muted icon: Contact information
   (contact card), Household (house), Voter demographics (clipboard), Voter
   Support (badge), Activity feed. Ours has three plain headers. `ActivityFeedCard`
   is _not_ blocked and I could have iconed it alone — I deliberately did not,
   because one iconed header between two plain ones is worse than three plain
   ones. Do all three at once: Contact information and Household
   (`PersonSheet.tsx` lines 165 and 206) and Activity feed
   (`ActivityFeedCard.tsx` lines 62–64). Suggested icons from `@styleguide`:
   `CircleUserRoundIcon`, `HouseIcon`, `HistoryIcon`.
2. **No map thumbnail of the door.** The prototype renders a small static map
   above "Open in Maps" (`MiniMap.tsx`). We have the coordinates on the stop
   already; only the render is missing. Cost: an extra map tile request per door
   opened, on a phone in the field — worth a deliberate yes or no.
3. **The resident switcher tabs have no person icon.** Prototype pairs each
   name with a small user glyph plus the status dot (`VoterPanel.tsx` line 332);
   ours has the name and the dot.
4. **Far less about the voter than the prototype showed.** The prototype panel
   carries registration status, voter status, marital status, children,
   veteran, homeowner, business owner, education, income and ethnicity across
   two cards. Ours shows age and party in the header and nothing else. Most of
   that was invented in the prototype, but the underlying columns do exist in
   the voter file — this is a product question (what should a canvasser see at
   the door?) that needs the route payload widened before it is a UI question.

**`WalkView.tsx`** (blocked on #1327)

5. **Progress bar is single-colour rather than segmented by outcome.** See item B
   above — a design call. Note ours already lists the per-status counts under the
   bar, so the segments would be a second rendering of the same numbers.

**`knockQuestions.ts`** (blocked on #1327)

6. **Wording: "Will they vote?" vs the prototype's "Will they vote this
   election?"** Ours is shorter; the prototype's is unambiguous about which
   election. These strings are shared with the printed walk sheet, which is
   transcribed back into the form, so changing one changes both — that is why it
   is a queued item and not a one-line edit.

**`NativeDoorKnockingPage.tsx` / `VoterMapCanvas.tsx`** (blocked on #1340 and a
live session)

7. **The map legend has no entry for the route line.** The prototype's legend
   ends with a "Route" swatch — a short blue line — so the path drawn between
   stops is named. Ours legends the seven dot colours and leaves the line
   unlabelled (`Legend`/`RouteLineItems`, `DoorKnocking.tsx` lines 3119–3134).
8. **The map does not shrink as you scroll.** The prototype collapses its map
   band from 360px to 220px once the list below is scrolled into (`mapCompact`,
   `DoorKnocking.tsx` lines 4419 and 4495), giving the stop list more room
   mid-walk.
   Ours is a fixed 40% band. Lowest priority of anything on this page — likely a
   deliberate consequence of our different layout, but no decision is recorded.

**Not drift, for the record:** the prototype's "Recommended lists" — AI-suggested
turf with a "why we recommend this" explanation — does not exist in our build at
all. That is an unbuilt feature rather than UI drift, and it is not in scope for
this review.

---

## What I checked and found no drift in

`statusPresentation.ts` (the status names and the six colours are the
prototype's, deliberately — "the vocabulary is the demo's: unknown grey, not
home yellow, supporter green, non-supporter red, inaccessible dark grey, refused
black", lines 25–27 — with a seventh, _Not a voter_, added for a case the
prototype had no data for), `TurfRoster.tsx` (has no
prototype counterpart — the prototype never listed a saved list's doors), the
create flow's three-step header and progress indicator, the door script
(deliberately the candidate's own saved issues rather than the prototype's
"AI-generated talking points" — `AGENTS.md` line 68), and the walk estimate copy.
