# Door knocking: where our build differs from the prototype

This compares the shipped door-knocking feature against the Lovable prototype
(`Remix of Door Knocking - 1 Page Self-Serve`), screen by screen, and sorts every
difference into one of three piles:

- **Deliberate** — someone decided to depart from the prototype, and wrote down
  why. These are listed below for product to confirm or overturn. Nothing here
  has been changed.
- **Accidental** — the prototype had it, we lost it or never built it, and no
  decision is recorded. These are fixed in PR #1346, which is open alongside this
  document and has not been merged, so they are not live yet. They are listed
  near the end so you can see what is about to move.
- **Still open** — real differences that are nobody's decision yet, listed near
  the end with a recommendation each. Two of them cost more than a UI change and
  need a product answer before an engineering one.

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

**Evidence it was deliberate** — `AGENTS.md` line 92:

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

### 3. A canvasser can write a note on any door; the prototype only allows one after a conversation

**Prototype:** the note field appears on the engaged branch only, after "do they
support you" and "will they vote".

**Ours:** the note field appears at the end of whichever branch was walked, so a
not-home or inaccessible door can carry one too. It is never required.

**Evidence** — `AGENTS.md` line 63 records this as one of exactly two deliberate
departures from the prototype at the door:

> The prototype puts the note field on the engaged branch only [...] **The
> product owner overruled that specifically**, because most doors never open and
> those are the ones a canvasser most often has something to say about: "dog in
> the yard, come back Saturday" is the archetypal note.

**Why it matters to product:** this is the one place the at-the-door flow
knowingly does not match the prototype, and the same note warns future work not
to "re-hide the note field" in the name of prototype fidelity. Worth confirming
you still want it, since everything else in that flow was rebuilt to match the
prototype exactly.

**Recommendation:** keep. It also closed a real defect — with the field on the
engaged branch only, a note typed there and then corrected to a not-home outcome
was saved invisibly.

---

### 4. "Why aren't they a voter?" is asked after the door is saved, not before

**Prototype:** choosing "Not a voter" opens a "What happened?" question (Moved /
Deceased) inside the flow, and Save is blocked until it is answered.

**Ours:** the door saves on the outcome alone, and the follow-up appears
afterwards as an optional prompt.

**Evidence** — `AGENTS.md` line 61, the second of the two deliberate departures:

> ADR 0008's follow-up is **optional**, and a door that is only written once an
> optional question has been answered is a door lost whenever the canvasser
> walks away mid-question.

**Plain version:** the prototype's version risks losing the knock entirely if the
canvasser is interrupted between the outcome and the follow-up — which at a door
is the normal case, not the edge case. Ours records the door first and then asks.

**Recommendation:** keep.

---

### 5. Counts on an unknocked list read "About 68 doors", not "68 doors"

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

### 6. The audience breakdown covers party and age only

**Prototype:** four groups — support, party, age and **top issues** — plus a
"Demographic highlights" summary ("62% Democrat", "31% aged 35–50").

**Ours:** party and age, as labelled bars with counts and percentages.

**Evidence** — `AGENTS.md` line 92 and `audienceMix.ts` lines 12–18:

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

### 7. A door nobody has visited reads "Support unknown", not "Not visited"

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

### 8. Age groups are 18–25 / 25–35 / 35–50 / 50+, not the prototype's

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

### 9. Stop numbers appear on the map and on paper, but not in lists

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

### 10. Delete is shown greyed-out with a reason; Edit disappears

**Prototype:** a "…" menu on each list card holding Delete.

**Ours:** Delete is a button on the list row _and_ in the detail sheet. On a list
that has been knocked it renders disabled with the sentence "this list has
already been knocked…" beside it. Rename/recolour, by contrast, is hidden
entirely once a list is knocked.

**Evidence** — `AGENTS.md` line 90:

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

### 11. The list-building flow never shows two different totals side by side

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

### 12. A saved list doesn't show street addresses until it is knocked

**This one has already moved most of the way toward the prototype**, in work that
merged while this review was being written, so it is listed for completeness
rather than as an open question.

**Prototype:** addresses are visible everywhere, including while drawing.

**Ours, now:** the draw step lists the real street addresses inside the shape you
have drawn, on request ("See the addresses"). The one surface still without them
is the detail sheet of a saved list that hasn't been knocked, which says "Street
addresses arrive with the route, once you knock this list."

**Evidence** — `AGENTS.md` line 91 records both halves: the map layer "is
`positions`, two index arrays and demographic byte planes, carrying no name and
no address at any price", and the draw step now answers from the server instead —
"that sentence used to be shared with the draw step and no longer is". The same
note says extending it to a saved list is "deliberately open rather than done".

**Plain version:** the fast map layer physically holds no addresses. Reading them
costs a database scan, which the draw step now pays when a candidate asks for it.
The saved-list sheet could be given the same treatment and hasn't been.

**Recommendation:** worth asking product whether the saved-list sheet should get
the same "See the addresses" affordance the draw step now has. Everything needed
is in place; it just hasn't been designed.

---

## Where the prototype is arguably wrong, and we should not copy it

Three items above (1, 2 and 5) are in this category too. Two more:

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

**Recommendation:** a design call, not a bug — and one worth making explicitly,
since it is the only place a canvasser sees progress while walking.

---

## What was accidental, and is fixed in PR #1346 (open, not yet merged)

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

### 4. The door sheet's cards had lost their icons too

The panel a canvasser opens at a door is a stack of bordered cards — Contact
information, Household, Activity feed — whose headers were text alone, so
finding the one with the phone number in it meant reading three near-identical
bars on a phone screen. The prototype pairs each card title with a glyph at the
far end of the row. Restored, along with the prototype's person glyph on the
resident switcher, where a strip of names and coloured dots otherwise reads as
filter chips rather than as the people behind one door.

All four are covered by new tests.

---

## Still open — small differences nobody has ruled on

These are real, and none of them is blocked on anything any more. They are here
rather than fixed because each is either a judgement call that should be made
deliberately, or costs more than a UI change.

1. **No map thumbnail of the door.** The prototype shows a small static map above
   "Open in Maps" so a canvasser can see the house's position without leaving the
   app (`MiniMap.tsx`). We have the coordinates already; what's missing is the
   render, and it isn't free — the prototype used Google Maps, we use a different
   mapping stack, and the door sheet is deliberately kept outside the heavy map
   bundle so it opens instantly on a phone with one bar. Doing it properly means
   a static image request per door opened. **Recommendation:** ask for it only if
   canvassers say "Open in Maps" isn't enough; it is a real cost for a
   nice-to-have.

2. **We show far less about the voter than the prototype did.** The prototype's
   panel carries registration status, voter status, marital status, children,
   veteran, homeowner, business owner, education, income and ethnicity across two
   cards. Ours shows age and party in the header and nothing else. Most of that
   was invented data in the prototype, but the columns do exist in the voter
   file. **Recommendation:** this is a product question — what should a canvasser
   see about a person before knocking? — and it needs answering before it is an
   engineering one, because the door payload has to carry whatever is chosen.

3. **The map legend never names the route line.** The prototype's legend ends
   with a short blue line labelled "Route". Ours legends the seven dot colours
   and leaves the line unlabelled. **Recommendation:** leave it. Our legend chips
   are not labels — they're filters, each carrying a count, and tapping one
   narrows the map. A "Route" pill with no count that does nothing when tapped
   would teach people the row is decorative. If it's wanted, it belongs beside
   the map, not in that row.

4. **The map doesn't shrink as you scroll during a walk.** The prototype
   collapses its map band from 360px to 220px once the canvasser scrolls into the
   stop list, giving the list more room mid-walk. Ours is a fixed 40% band.
   **Recommendation:** lowest priority here; worth a look if canvassers complain
   about list space on small phones.

5. **The walk progress bar is one colour, not five.** See item B above — this is
   the design call, and our version already prints the per-outcome counts below
   the bar.

**Not drift, for the record:** the prototype's "Recommended lists" — AI-suggested
turf with a "why we recommend this" explanation — does not exist in our build at
all. That is an unbuilt feature rather than UI drift, and it is out of scope for
this review.

---

## What changed under this review while it was being written

Three pieces of work merged mid-review, and two of them removed findings that
were on this list in an earlier draft. Recording that here so the document can be
trusted against the code as it stands today.

- **The at-the-door flow now matches the prototype, and did not when this review
  started.** It used to be a single row of seven one-tap result chips; it is now
  the prototype's question walkthrough — "Did they answer?", then "Did they
  engage?", then support, then will-vote, each question staying on screen as the
  next appears. Everything I had recorded as drift in that flow is resolved,
  including a wording difference ("Will they vote?" against the prototype's "Will
  they vote this election?") which now matches exactly. The two departures that
  remain there are items 3 and 4 above, and both are recorded as deliberate.
- **The draw step now lists real street addresses**, which changes item 12 from a
  flat difference into a question about one remaining surface.
- The map's opening view changed, with no effect on anything in this document.

---

## What I checked and found no drift in

`statusPresentation.ts` (the status names and the six colours are the
prototype's, deliberately — "the vocabulary is the demo's: unknown grey, not
home yellow, supporter green, non-supporter red, inaccessible dark grey, refused
black", lines 25–27 — with a seventh, _Not a voter_, added for a case the
prototype had no data for), `TurfRoster.tsx` (has no
prototype counterpart — the prototype never listed a saved list's doors), the
at-the-door question walkthrough and every one of its question and answer labels
(they match the prototype word for word, including "Will they vote this
election?"), the create flow's three-step header and progress indicator, the
door script
(deliberately the candidate's own saved issues rather than the prototype's
"AI-generated talking points" — `AGENTS.md` line 71), and the walk estimate copy.
