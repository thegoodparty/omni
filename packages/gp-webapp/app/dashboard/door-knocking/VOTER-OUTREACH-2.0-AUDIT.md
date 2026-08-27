# Door knocking vs the Voter Outreach 2.0 canvas

An independent audit of the four rebuilt door-knocking surfaces against the
canvas prototype (`Voter Outreach.dc.html`, the door-knocking region at lines
5289–5838). It is written to be read without opening any code: for each
difference, what the canvas does, what we do, and which of three piles it falls
in.

- **Fixed in this PR** — the canvas had it, we had drifted or never built it,
  and adopting it was unambiguous. 7 items, the last of them added on 2026-08-26
  after the door panel and the canvas panel were photographed side by side. It
  is worth saying why that item was not in the first six: reading the prototype
  source finds missing fields and wrong words, and this audit found plenty of
  both. It does not find a card that has the right fields in the wrong
  container. Compare renders, not markup.
- **Deliberate, and still right** — we depart on purpose, the reasoning is on
  record, and I re-checked that it still holds. 18 items, of which **one has
  since been overturned**: item 14, the walk's single-colour progress bar, which
  the product owner ruled against on 2026-08-25. The canvas's segmented bar is
  built. The entry is struck through and kept, with the argument that lost and
  the reason it lost, because a departure that the person who owns the surface
  reads as a bug is the useful thing to have written down.
- **Needs a product answer** — a real difference that is somebody's decision,
  not an engineer's. 8 items, of which **four have since been answered and
  built**: item 4, the drawer's breakdown of how the walk went, which overturned
  the recorded ruling against it; items 3 and 5, the confirm step's map band and
  which of its two save buttons leads, both shipped in #1438; and item 6, the
  panel's "Voter support" card, built as a stance-or-silence card with its
  will-vote half still open. They are left in place with the arguments that
  settled them rather than moved, because the decision is the useful part.
- **Deferred, with a named precondition** — right to build, wrong to build now,
  and the thing that has to change is written down. 1 item, under _Empty,
  loading, error and first-run states_: the canvas opens the create flow by
  itself for a candidate with no lists, and we will once
  `GET /v1/door-knocking/pack` is fast enough to open a flow on.

**34 differences total.** The build is close to the canvas. Most of what looks
missing is either the "three quantities" problem the previous review describes
(a stop, a door and a person are different things live, and the prototype's data
made them identical) or a deliberate correction of something the canvas itself
gets wrong. Two genuine misses are worth product attention, and one of them is
the single most important finding here.

The headline: **the canvas lets a canvasser walk from door to door without
leaving the door panel, and we did not build that.** It is fixed in this PR.

---

## The most important thing we missed

**The canvas's door panel navigates the route. Ours was a dead end.**

The canvas panel header is four things in a row: a back chevron, the stop's
route number, the person, a forward chevron (`renderPanel`, line 5382):

> `route && navBtn('chevron-left', ()=>this.openPanel(route[idx-1].id), hasPrev)`

Ours had the name, the age and a close button. To reach the next house a
canvasser had to close the panel, find the row in the list (which may have
scrolled away), and tap it — three deliberate actions, on a phone, at a door,
usually one-handed. Auto-advance covered the case where a door had just been
logged; it did nothing for the far more common case of a door you looked at and
walked away from.

This is fixed. Both chevrons are always rendered and disabled at the ends of the
route, they move the list along with the panel, and the panel now carries the
stop's own number — the same numeral the list row, the map pin and the printed
sheet all use, so "I'm at stop 14" means one thing everywhere.

It is worth saying what this is _not_. The walk's auto-advance is still
forward-only, and deliberately: it moves the canvasser without being asked, and
sending them back up a street they have already walked is exactly what it must
never do. These chevrons are asked for.

---

## Fixed in this PR

### 1. Door-to-door navigation in the door panel

Above. The most substantive item in this audit. One detail worth recording
because it only appears once the panel can walk: because the panel stays open
between doors, its scrolling body kept whatever offset the last house was read
at, so arriving at the next door could land you halfway down the panel, past the
address and the phone numbers. It now returns to the top on each new door — but
not when you switch between two people at the _same_ door, where the content is
the same page and jumping to the top under the canvasser's finger would be its
own bug.

### 2. The door panel never said which stop it was

The canvas draws the stop's number in the panel header
(`idx>=0 && h('span',{...}, idx+1)`). Ours did not, so the one surface a
canvasser spends the most time on was the only one that could not answer "which
house is this?". Now it shows `Stop 14`, off the route's own `seq`.

### 3. A stop row's people count was a bare numeral

The canvas puts a person glyph in front of it (`this.icon('users',14),
householdCount(v)`). Ours printed the digit alone, one gap away from the stop's
own numeral in its coloured circle — so a row read `12` `3`, naming neither
quantity, and to a screen reader it read "Stop 12, 3". Now it carries the glyph
and, for assistive technology, the noun: "3 people to knock".

### 4. The colour swatches were labelled with hex codes

Both pickers — the create flow's confirm step and the edit dialog — labelled
their eight swatches `Turf color #2563eb`. The canvas labels its own with the
colour's name (`'aria-label':opt.label`). Choosing a list colour by keyboard or
screen reader meant listening to eight hex codes read out one character at a
time. They are now Blue, Green, Amber, Red, Purple, Teal, Pink and Lime, and the
selected one carries the canvas's tick inside it, so the choice is not conveyed
by colour and a thin ring alone. The tick inverts with the swatch underneath it:
a white one fails WCAG AA on four of the eight (green, amber, teal and lime),
which would make the mark that exists to show the choice the least legible thing
on the control. It reuses the same rule the walk list already applies to the stop
numeral sitting on its status circle, and a test now sweeps both palettes.

### 5. The list details drawer never said what state the list was in

The canvas draws a status indicator beside the name in **both** details drawers
(`renderDkDetails`: `statusIndicator(list.completed?'done':(knocked>0?
'in-progress':'scheduled'))`). Our outreach history drawer has always rendered
one; the door-knocking drawer rendered nothing. So a candidate could open Details
on a finished list and find nothing on the surface that knew it was finished —
the footer's "Move to archive" button was the only clue.

It now renders the same component the outreach drawer does, so one saved list is
described in one vocabulary from both entry points: **Not started** before it is
knocked, **In progress** once it has a route, **Done**, **Archived**. (Archived
is ours — the canvas has no shelf, and "Done" would be a lie about a list the
rail has taken off the active section.)

**The unknocked state is a deliberate departure from the canvas, and the second
one in this section.** The canvas says `scheduled` there, and this audit
originally transcribed it as **Scheduled** — accurately, which is the point
worth recording. A politics domain expert then read that label on a list he had
drawn and never walked and asked when it had been scheduled. It never had been,
and could not have been: door knocking has no send time, no date picker and no
scheduling concept anywhere in the flow. The canvas's `STATUS_META` is six
states written around the sending channels, where the flow does end on a date
picker and the row does carry a `scheduledAt` — it has no "hasn't begun yet"
bucket, so its door-knocking screen borrowed the nearest word. Reading the
canvas correctly is what produced the confusing label, so this is a canvas
defect inherited faithfully rather than drift on our side.

**Not started** says what the canvas meant (`knocked === 0`) in the words this
vocabulary already uses for the other two positions on the same axis. It cannot
collide with the sending channels' Scheduled, which is untouched and still means
a bought send with a real time on it, and it cannot put the two drawers out of
step: the `Outreach` envelope is written by the knock transaction, so a list in
this state is in no outreach history at all, and from the moment it is, both
surfaces read In progress. `turfLifecycle.test.ts` asserts both halves so a
future parity pass against the canvas cannot quietly put the word back.

### 6. The door panel's card stack was one card where the canvas has three

Found on 2026-08-26 by photographing both panels rather than reading either
file, which is why an audit written from the source missed it: every card we
drew existed, every field was present and correctly worded, and the panel still
did not look like the canvas.

The canvas's `renderPanel` (lines 5404–5427) draws four cards in order under the
header — **Household**, **Voter demographics** (registered voter, voter status,
political party), **Voter support**, **Demographic information** (marital
status, has children under 18, veteran status, homeowner, business owner, level
of education, estimated income range, language, ethnicity group) — and every one
of them is a single column of `panelField` rows, label over value, both at 14px.

Ours merged the first and last of those three profile cards into a single
"Demographic information" card laid out as a **two-column grid**, put Household
_after_ it, and pinned the support card in the footer. The effect is that
"Registered voter" sat in the cell beside "Marital status": a voter-file fact
about whether this person can vote at all, and a modelled guess about their
household, reading as two entries in one list. The card boundary is the claim,
and we had erased it.

Fixed: three cards in the canvas's order and Household above them, all single
column. Three labels still depart on purpose ("Turnout likelihood", "Has
children under 18", "Estimated household income" — see AGENTS.md), and two that
had drifted for no reason are back to the canvas's words ("Veteran status",
"Ethnicity group"). Political party moved out of the header subtitle into the
Voter demographics card, which is where the canvas has it; our header now reads
"47 years old" alone, as the canvas's does.

Two smaller things the same comparison turned up, both left alone and both
recorded in AGENTS.md rather than fixed here: the canvas draws talking points as
the first card in the body where we pin the script in the footer (a real
judgement call, and ours has an argument), and the canvas's footer begins
directly with "Did they answer?" where ours adds a "Log this door" heading
(ours, redundant, and removable only as a rename across two other test suites).

### 7. Two small copy items

- "Move to Archive" → **"Move to archive"**, on the rail card and in the drawer,
  matching the canvas's sentence case.
- The confirm step's caption dropped four words: the canvas says "Review the
  route, give it a name and color, then save it **to your team**." A turf is
  visible to the whole campaign, so the canvas's wording is both the canvas's
  and true.

---

## Needs a product answer

### 1. A list you have not knocked yet reports no size at all

**Canvas:** every list card carries three figures — households, people, and an
estimated duration (`this.icon('clock',14), formatDuration(...)`).

**Ours:** doors and people-logged, and **only once the list has been knocked.**
The three counts on a saved list are derived from its frozen route, so they are
`null` — deliberately, not `0` — until one exists. A candidate who creates three
lists on Sunday evening sees three cards with a name and some buttons and no
indication which is a two-hour walk and which is a Saturday.

**Why it isn't just fixed:** the numbers exist, but not cheaply. Answering it
means either a pass over the decoded voter pack per list in the rail (the drawer
does exactly one such pass, for the one list it is describing) or three new
pre-route fields from the API. The previous review recommended the latter as "a
small backend change" (§ _Still open_, item on `doorCount`); this audit is the
second surface to want it. **This is the highest-value item on this list.**

### 2. Recommended lists do not exist in our build

The canvas's who step opens with an AI-suggested list — a pre-drawn boundary
with pre-applied filters and a reason — and picking one jumps straight to the
draw step with the shape already outlined and its own copy: "We've already
outlined the doors to knock for you. Drag any boundary point to adjust the
area."

This is recorded in the previous review as out of scope ("an unbuilt feature
rather than UI drift"), and I agree it is not drift. But it is worth restating
that the 2.0 canvas still has it, that it is the first thing a new candidate
sees in the canvas's create flow, and that it is the canvas's answer to the
cold-start problem our purpose step answers with a list of goals. It is a
feature request, not a fix.

### 3. The confirm step has no picture of what you drew — **answered and built (#1438)**

**Canvas:** a 192px map at the top of the confirm step showing the selected
voters and the polygon, tinted in the colour being chosen just below it.

**Ours, when this was written:** no map on that step — the sheet was full height
and covered the page's map. The concrete cost was the colour picker: it asked a
candidate to choose the colour their list would be drawn in on the map, with the
map hidden. The stats line (now "N stops · N doors · N voters", reordered
2026-08-26) was the only description of the shape.

**Ours now:** the confirm sheet opens short of the top rather than full height,
and the strip it leaves is the page's own map — not a second instance. The ring
is fitted into that strip on arrival (`frameDrawToken`, with the sheet's height
handed to `fitBounds` as bottom padding, so the shape lands in the band that is
left rather than centred behind the sheet), and it is drawn in the colour the
picker below is currently on (`drawColor`), which is what makes choosing a
colour a judgement instead of a guess.

The two design decisions this item said were needed were both taken the third
way: no second map instance and no transparency. The band is the live map with
a shield over it, because the drawing session is still open at that point and a
tap on the revealed strip would splice a vertex into the very shape being
confirmed, with no Undo on that step to take it back. Since the band is a
picture, maplibre's zoom and compass buttons come down with it
(`controlsHidden`) — a shielded "+" is a control that answers nothing.

### 4. The details drawer has no breakdown of how the walk went — **built, and the ruling against it overturned**

**Canvas:** a status breakdown table on the details drawer — each of the seven
canvass statuses with a count and a percentage — in the door-knocking drawer and
in the outreach history drawer.

**Ours, when this was written:** one figure, "People logged — 34 of 61 · 56%",
with a bar. A candidate who wanted to know how a finished walk actually went —
how many doors were refusals, how many nobody was home — could only get it by
re-entering the walk.

**Ours now:** a "How the walk went" section on the drawer, one row per canvass
status with a count, a percentage and a bar in that status's own colour.

This is the one item in this audit where a **recorded ruling was overturned**
rather than confirmed, and it was overturned with the product owner's agreement.
The argument is written out here in full rather than cited, because it is the
whole content of the decision.

**What the ruling was.** The outcome table had been refused on the grounds that
it would reprint the landing rail's seven canvass-status chips: the rail already
shows a `canvassStatusCounts` chip per status one click away, and reporting one
quantity twice, in two visual forms, on two surfaces reached from each other is
how two presentations of it start disagreeing.

**Why it no longer holds for a knocked list.**

- **They are not the same numbers.** The rail's chips are computed from the
  voter pack over the list's polygon and filters — a superset, which is why the
  rail itself hedges them as "About". A knocked list's outcomes come from its
  frozen route and are exact, which is the same reason the drawer's own door and
  people counts stop being hedged once a route exists. Two quantities that
  legitimately differ is the opposite of one quantity reported twice.
- **They are not the same scope.** Details can be opened on a list that is not
  the selected one, in which case the rail's chips are describing a different
  list entirely while the drawer describes the one on screen.

**What the old argument still gets right, and what was kept because of it.** For
an **unknocked** list both readings really would come off the same pack pass, so
the new section has no pre-route branch at all: it says "Not knocked yet" and
draws nothing. And because the worry was two presentations drifting, the table
shares its arithmetic with the walk rather than computing its own — one helper
(`knockStatusCounts`) buckets the route, and the walk's seven-count strip and
this table both read it, so the walk and the planning surface cannot report one
list differently. Breaking that helper fails the tests behind both surfaces,
which is the point of sharing it.

Three constraints carried over from the existing rules: the denominator is
knockable people (so the seven rows sum to the People stat above them, and the
six non-unknown rows sum to the people-logged figure), the word is **logged**
and never "reached", and nothing re-derives a status client-side — each door's
outcome is the value gp-api already computed.

**One wrinkle, decided deliberately.** "Not a voter" is both a flag that removes
someone from every people count and an outcome a canvasser can log at the door —
and the flag is only set when the optional "what happened?" follow-up is
answered. So a resident logged not-a-voter with nothing answered yet is still in
the denominator, and lands in that row. The table keeps them there, so its rows
still sum to the People stat, and the section says so in a line that appears only
when that row is non-empty: answering the follow-up takes the resident out of the
table altogether rather than moving them to another row.

### 5. Which button should the confirm step lead with? — **answered and built (#1438)**

**Canvas:** the primary button is "Save and draw another"; "Save and exit" is
the outline one beside it.

**Ours, when this was written:** exactly inverted — "Save and exit" was primary.

Both buttons exist and do the same two things either way; what differs is which
one the flow presents as the expected next move. The canvas assumes a candidate
cutting several nights of walking in one sitting; ours assumed one list at a
time. It was a product intent question, and the answer was the canvas's: a
candidate who has opened this flow has sat down to cut turf, so the expected
next move is the second shape and not the door out.

**Ours now:** "Save and draw another" leads and "Save and exit" is the outline
beside it. One detail worth recording because it only shows up once the order is
flipped: the pair is `outline` and not `secondary`, because the styleguide's
secondary is a filled tonal button — two filled buttons side by side weigh the
same, and leading with one of them would then say nothing at all.

### 6. The panel's "Voter support" card — **answered and built, with one half still open**

The canvas panel carries a card stating the resident's current support level and
whether they will vote. We ask both questions in the knock form and store both
answers, and they appear in the activity feed with a date and an author — but
there is no card stating them as current facts. Our version is arguably the
more honest presentation (an answer given in June and an answer given in October
are different things), but the canvas's is a real difference and it is the same
family of question as the previous review's still-open item on how much of the
voter file a canvasser should see before knocking.

**Built.** The card states a support stance and the month it was given, and it
is deliberately **silent** where the canvas prints "Not logged" — the honesty
concern above is what the silence answers, not something the card overrode. It
now sits in the body between the two profile cards, where the canvas draws it;
it first shipped pinned in the footer, and the reasoning for both positions is
in AGENTS.md. **The will-vote line is still not built**, because nothing derives
that answer into a current value the way support becomes `knockStatus` — the
door has an answer in the CRM and no fact to state. Closing it is a decision
about where the derivation lives, and phone banking has the same hole.

### 7. The page has no AI bar

The canvas ends `renderDoorKnocking` with `this.renderAiBar('Ask about your
turf, routes, or canvassing…')`. We have nothing equivalent on this page. This
is platform chrome rather than a door-knocking surface, so it is noted rather
than argued.

### 8. Deleting a list from inside the walk

The canvas's walk kebab offers "Delete list". Ours does not — delete lives on
the rail card and in the details drawer, both of which the walk is entered from.
Arguably correct (deleting the list you are standing in the middle of is a
strange gesture), but it is a canvas affordance we do not have anywhere in the
walk.

---

## Deliberate, and still right

Each of these was re-checked against the canvas, not just against the record.
Nothing was changed.

**Numbers and vocabulary**

1. **"N / M doors knocked" on the card.** The canvas's overline counts doors;
   ours reports people logged in the meta row, because at a block of flats one
   door is many people. Recorded as § A of the previous review, and the reason
   is a property of our data, not of either prototype.
2. **"About 68 doors" on an unknocked list.** Recorded, §5. The count is exact
   for what the map can shade and a superset of who gets knocked; the gap
   belongs to the preview, never to the filter.
3. **"Support unknown" rather than "Not visited".** Recorded, §7, and answered
   by the 2026-08-20 product call.
4. **Party and age only in the audience breakdown.** A survivorship constraint
   rather than a design preference, and it is unaffected by the outcome table
   built under _Needs a product answer_ item 4: the voter pack carries sixteen
   dimensions, but a frozen route's targets carry a live `age` and
   `politicalParty` and nothing else (`native/audienceMix.ts` lines 4–18), so a
   breakdown built on the pack's full set would empty itself the moment the list
   was knocked — a candidate watching fourteen dimensions disappear as a reward
   for walking. Two that survive the lock beat sixteen that don't. Separately,
   the canvas's "top issues" group is data we do not hold in any form — no pack
   dim, no route field, no column — so it could only ever be empty or invented.
   Those two refusals stand on their own; the third that used to be argued
   alongside them (the canvas's "support" group) is the one that was overturned.
5. **Age buckets.** Recorded, §8.
6. **Travel time vs knocking time on the drawer.** The canvas has one
   "Estimated time"; we have two labels because they are two quantities
   (Geoapify's figure is movement between doors with zero time spent at them).
7. **`Saved lists (N)` rather than the canvas's `Saved lists · N`.** The
   2026-08-20 call.

**The create flow**

8. **No per-option count on the filter pills, and no disabling at zero.** The
   canvas computes `countMatching(...)` per option and greys out any option with
   none. We cannot: the pack has no bucket for several filters that gp-api
   honours perfectly well at knock time, so a pill showing "0" would be wrong
   and disabling it would block a filter that works. The rule throughout this
   feature is that the gap is the preview's, never the filter's. _(Newly
   recorded — this was not written down before.)_
9. ~~**"Continue (N doors)" rather than "Add to saved lists (N)"** on the draw
   step. The canvas's own handler does not save there either; it opens the
   confirm step, exactly as ours does. Adopting that label would promise a write
   that does not happen.~~
   **Half overturned by the product owner, 2026-08-26: the verb stands, the
   count is gone. The button is now the bare word `Continue`.**

   The departure from the canvas's _verb_ is unchanged and still right — that
   handler opens the confirm step, and "Add to saved lists" would promise a
   write that does not happen. What went is the parenthesised count, which this
   entry had quietly kept from the canvas's `(N)` while arguing about the words
   in front of it. The case for keeping it was that the 2026-08-20 call had
   added a count to the outreach Filters CTA, making a count in a CTA the house
   pattern; the owner's reading of that same call was the reverse — "I think
   that's actually why we didn't show the exact count in the button" — and it
   is their call to make.

   **This is now a departure from the canvas in a second respect, so it is
   recorded rather than left to look like drift.** The canvas prints a number
   in this button and we do not. The reason it costs nothing: the draw step's
   stats bar sits directly above the button and renders unconditionally, so in
   every state where Continue is enabled the door count is already on screen —
   the canvas says it twice and we say it once. The states where the bar would
   be absent are exactly the states where the button is disabled and carrying a
   different message anyway (`Tap 3 points to continue`, `1 more point to
continue`, `No doors in this area`).

   **The same call took the count out of the who step's CTA, which is the
   other Continue button in this flow, and that one is a departure the audit
   did not previously have to record.** It read
   `Continue (1,500 households)` and was never a departure at all — the canvas
   prints the matching count in that button, so we were following the
   prototype. It is a departure now, on the same grounds: no Continue button in
   this flow carries a count. Leaving the two steps disagreeing was the visible
   symptom that made this worth deciding once rather than twice.

   **What is different about the who step, and why the number did not simply
   go:** the draw step could drop its count because the stats bar above it
   already said it. The who step has no stats bar. `districtHouseholds` is the
   size of the filtered draft, and the only other figure on that step is the
   picker's `All contacts (N)`, which is the **unfiltered** universe and does
   not move when a pill is toggled — so the CTA was the one place a candidate
   could see how big the audience they were cutting had become. Deleting it
   would have been a real loss rather than a de-duplication. So it moved to the
   line beside the button, which reads "N matching households across your whole
   district. You'll draw the area to knock next." — the number and the
   denominator in one sentence, which is where they were before the canvas
   moved the number into the CTA. Zero still disables the button and says
   `No matching households`.

   Logged rather than edited in place, because "the count was defended on the
   Filters-CTA precedent and the owner rejected the precedent" is the useful
   record; an entry saying only "bare Continue" would invite the next reviewer
   to re-derive the argument and put the number back.

10. **"Continue" rather than "Save and continue"** on the name step, for the
    same reason and already recorded in the step's own comment: the voter list is
    written with the turf, by the one save path on the confirm step, so nothing
    is left behind by an abandoned flow.
11. **A blocking stop-limit message rather than the canvas's toast.** The canvas
    warns "List too large" in a toast and lets you try again; ours says "Over the
    150-stop limit — draw a smaller area." inline, next to the disabled button,
    and adds a softer warning above 100.
12. **No numbered stop list on the confirm step.** The canvas lists every stop in
    route order. No order exists at that moment — the route is bought when the
    list is first knocked — so the numbering would be invented. The addresses
    themselves are one step back, behind the draw step's "See the addresses".
13. **Every filter group visible by scrolling** rather than the other channels'
    popover picker. The 2026-08-20 call.

**The walk**

14. ~~**A single-colour progress bar** rather than the canvas's segmented one,
    with the per-outcome counts printed underneath. Recorded, § B.~~
    **Overturned by the product owner, 2026-08-25, and the canvas's segmented
    bar is now built.**

    The original argument was that one bar answers "how far through am I", the
    counts under it answer "how did it go", and stacking six colours into a bar
    six pixels tall makes a thin segment unreadable while claiming to be a
    chart. That reasoning is not wrong, but it was weighed by an engineer and
    the call was not one to make from here: the product owner opened the walk,
    saw a blue bar where the canvas has a coloured one, and read it as drift
    rather than as a decision. That is the whole test a departure has to pass —
    if the person who owns the surface cannot tell your reasoning from a bug,
    the reasoning has lost.

    What was built is the canvas's bar, and the objection is answered rather
    than ignored: the counts stay underneath (the canvas prints them too, and
    they are what makes a two-pixel segment mean anything), the bar is 8px
    rather than 6, and `unknown` is deliberately not a segment — the track
    shows through for it, so what is coloured is what has been logged and what
    is grey is what is left. A seventh segment would have filled the bar on a
    walk where nothing had happened yet. The segment order is shared with the
    legend below it (`PROGRESS_STATUS_ORDER` in `statusPresentation.ts`), so
    the bar and the words under it cannot come apart.

    Logged here rather than deleted, because "we tried one bar and the owner
    wanted six" is the useful record; a line saying only "segmented bar" would
    invite the next reviewer to re-derive the original argument and change it
    back.

15. **Read-only travel-mode and loop chips** in the walk. The route is frozen;
    the mode it was bought for cannot be changed from inside it. (The details
    drawer does let you _read_ the figure in the other mode, which the canvas
    does not offer at all.)
16. **"Mark this list done" on the rail card**, not in a walk kebab. Recorded in
    `AGENTS.md`: it is the one list action with no undo beside it, so it sits
    inside the expanded card rather than one stray tap from a list that stops
    offering Knock.
17. **Talking points are the candidate's own saved issues**, not the canvas's
    "AI-generated from this voter's profile and your candidate info."
18. **"Notes (optional)" rather than "What did they say? We'll clean it up."**
    The canvas's placeholder promises an AI cleanup pass we do not run.

**Two places we are ahead of the canvas**

- The canvas's own navigation chevrons are labelled with the icon's name
  (`'aria-label':icon` — literally "chevron-left"). Ours say "Previous door" and
  "Next door".
- The canvas has no equivalent of our do-not-knock control (ADR 0007) or "not a
  voter" outcome (ADR 0008), both of which suppress people from routes and
  counts throughout.

---

## Mobile and responsive

Checked specifically, because this feature is used one-handed at a doorstep.

- **The manage view.** The canvas's phone layout is a scrolling column: a sticky
  260px map, then District voters, then the list cards. Ours is a bottom sheet
  over a full-bleed map, peeked by default and one tap from open. This is a
  recorded departure and it still looks right — the sheet stops short of the top
  so pressing a status chip still recolours dots the canvasser can see, which the
  scrolling column cannot do once you have scrolled past the map.
- **The page itself does not scroll, at any width.** That claim is the whole
  basis of the departure above — a sheet over a full-bleed map is only better
  than the canvas's scrolling column if the map is actually all there — and it
  was not true until 2026-08-26. The landing view sized its own column with
  `h-[calc(100dvh-4rem)]` while nothing above it was pinned to the window, so
  the campaign-manager chat's in-flow `h-24` spacer scrolled the document by
  96px on a phone and 32px on a desktop, and the hard-coded `4rem` (the
  `lg:hidden` mobile top bar) additionally left the desktop map 64px short of
  the bottom of the window. Fixed in `NativeDoorKnockingPage` by letting the
  flex chain supply the height; the reasoning is in `AGENTS.md`. Re-verify this
  by rendering rather than by reading, and at more than one height — the
  desktop case fit the viewport by 0px and the phone case did not, which is not
  a difference textual inspection can show.
- **The District voters legend wraps rather than scrolling sideways**, as of the
  same date and the same reviewer. The canvas's own legend is a wrapping flow of
  six chips; ours is seven, because `not_a_voter` is ours (ADR 0008). Checked at
  320px, where all seven still lay out two to a row with nothing clipped.
- **The door panel.** Bottom sheet under `lg`, right-hand panel above it, same as
  the canvas. The panel is 430px wide against the canvas's 448px; not worth a
  change.
- **The new chevrons** are full `IconButton` hit targets at the top of the panel,
  where a thumb reaches, rather than inline text links. They are drawn `ghost`
  rather than filled, which is the canvas's treatment and does not change the
  target: three filled primary circles around a person's name made the chrome
  the loudest thing on a panel whose subject is the person.
- **The live-location switch is a labelled pill in the walk's control row**, not
  a floating icon square over the map's corner. Same as the canvas, and it
  matters most on a phone: an unlabelled square is a control you have to press
  to find out about, and pressing this one turns on the GPS.
- **The create flow's who step** can be dragged down to peek at the map
  recolouring live underneath, which the canvas does not do on a phone at all.

## Empty, loading, error and first-run states

The canvas has one door-knocking empty state (`emptyCard`: "No saved lists yet"
/ "Your saved lists will appear here. Create your first list to start door
knocking.") and no loading or error states anywhere — it runs on a fixture.

We have that empty state in a longer form, plus: a rail skeleton, a distinct
"every list is archived" state, three separate states per statistic in the
details drawer (loading / unavailable / not knocked yet), a failed-route message
in the walk that deliberately does not fire when the walk is usable from cache,
a failed-address-preview state with a retry, a stale-boundary state for the
address list, and a save-failed message on the confirm step. **No canvas state
is missing.**

That last sentence was, for a while, the whole of this section, and it is true
about _states_ and wrong about _transitions_ — which is most of what "first run"
means. The canvas has a first-run rule for door knocking. We do not have it, we
are not going to build it yet, and both halves of that are worth writing down
properly, because the reason is a number that will change.

### The canvas opens the create flow for a candidate with no lists

**Canvas:** entering door knocking with an empty rail opens the create list flow
by itself, 60ms after the surface mounts. The rule is one line of
`openFlow(channel)` at line **2289** — the outreach flow-opening function shared
by all seven channels, some three thousand lines above the region this audit
reviewed:

> `if (channel === 'door') { this.setState({ doorOpen:true }); if (this.state.dkSaved.length===0) setTimeout(()=>this.openNewList(), 60); return; }`

**Ours:** the landing map, with the rail's empty card in it. A candidate with no
lists reads the card and presses Create list themselves.

**This audit missed it for a mechanical reason**, which is the useful part of
reporting it: the rule that governs a door-knocking screen does not live in the
door-knocking region. Anything scoped to lines 5289–5838 — this audit, and the
UI drift review before it — could only have found the surfaces the rule opens,
never the rule.

**It is a specification, not a demo shortcut.** Three things say so, and it is
worth being sure, because "the prototype just wanted to show the flow" would be
a perfectly ordinary explanation for a line like this:

- It is a **written conditional**. A shortcut into the flow would be an
  unconditional call; this one asks a question first.
- The manage view stays reachable **and keeps its own zero-list empty card**. A
  spec that meant "skip the landing view when there is nothing on it" would have
  no use for that card, and the canvas would not have written one.
- The two conditions read **deliberately different quantities**. The auto-open
  tests `dkSaved.length` — every list, archived ones included — while the empty
  card tests `savedVisible`, which is unarchived only. So a candidate who
  archived their last list gets the empty card and _not_ the auto-open. That
  asymmetry does nothing in a fixture and means something in a rule.

**It is also not "the first time you ever open the page".** It keys off server
state rather than a persisted flag, so it re-fires on every entry with an empty
rail — including for a candidate who has just deleted their last list. That is
the better of the two rules, and it is the one to build if we build it: a
first-run flag needs somewhere to live, and it strands exactly the person who
has arrived at an empty rail for the second time.

**We have deliberately not implemented it, and the reason is the voter pack.**
Our create flow is gated on the pack twice. The Create list button that opens
it is `disabled={!packQuery.data}`, and one step in, the who step's Continue
reads `districtHouseholds === 0`, disables itself and renders the literal text
**"No matching households"**. Both gates are right while the entry to the flow
is a button somebody presses: the button is simply unavailable until the pack
decodes, and the second gate is then unreachable.

Auto-opening only pays for itself if it un-gates the entry — spending the
pack's wait inside the flow, on the purpose and who steps, instead of staring at
a disabled button, is the entire benefit. And un-gating the entry is exactly
what makes that second state reachable. A brand-new candidate would be one tap
into the product and told, in a sentence, that their district contains no
matching households. That is a false statement rather than a spinner, and it is
the first thing the feature would ever say to them. Auto-opening _after_ the
pack lands avoids it, but then it costs nothing and buys nothing — the wait is
already over — and it silently never fires at all on the loads where the pack
never arrives.

Those loads are not rare, which is the whole of the argument:
`GET /v1/door-knocking/pack` currently takes **12.7–43.5 s** and **fails
outright about 15% of the time**.

**So: deferred, with a named precondition — not rejected.** This is a correct
thing to build, and a small change when the precondition is met. Once the pack
is fast and reliable, the who step's zero-household branch stops being a state a
first-time candidate can land in, and what remains is the canvas's own
conditional asked against our turfs query — where "no lists" is the same
`length === 0` and, per the rule above, should count archived lists too. The
precondition is a performance and reliability number on one endpoint. Nobody
needs to re-argue whether auto-opening is right; they need to check whether
`/pack` is still slow.

## Print

Not audited and not touched — another agent owns the paper itself. One thing
this pass did change: **where the walk reaches it, and what it is called.**

When this was written the canvas's walk offered a PDF download and we offered
"Print list" under the map, with the PDF reachable from the rail card and the
details drawer — so one artefact had two names depending on which surface you
asked from. The walk's link is now **PDF**, in the page header where the canvas
puts it, pointing at the PDF route rather than the HTML sheet.

It is also the only paper affordance left on the walk. #1455 removed the rail
card's, which was ours and never the canvas's, and that is what let this one be
matched against the prototype directly instead of triangulated against a
sibling row. The details drawer keeps its own, per list and only once that list
is locked — an unknocked list has no route to print.

---

## What I verified against, and what I did not

The canvas region audited is lines 5289–5838 of `Voter Outreach.dc.html`:
`renderWorklist`, `renderPanel`, `renderDkDetails`, `renderDoorKnocking`,
`dkListCard`, `dkLegend`, `dkMap`, `renderDkFlow`, `dkFooter`, `dkStepPurpose`,
`dkStepWho`, `dkStepName`, `dkStepDraw`, `dkStepConfirm` and `renderDkDelete`.
I did not review the ~640 screenshots in `uploads/`, the phone-banking and SMS
regions, or the canvas's Pro paywall gate (`proGate`), which is a billing flow
rather than a door-knocking surface.

**That region is not the whole specification, and the first-run rule is the
proof.** `openFlow(channel)` at line 2289 decides what happens when door
knocking is _entered_, and it is shared by all seven outreach channels, so it
sits nowhere near the region above — see _Empty, loading, error and first-run
states_. Anything else that governs a door-knocking surface from the shared
outreach shell is outside what was audited here. A later pass should read
`openFlow`, `openNewList` and the shell's own state around them.

**And reading the markup is not the same as looking at the screen.** This audit
and the two before it compared the prototype's TSX-in-HTML to our TSX, and all
three pronounced the walk in good shape. The product owner then opened the app
and listed a dozen differences in a minute. Reading source against source
catches missing text and missing sections; it is structurally blind to icons,
colours, spacing and placement, which is the entire category that was missed —
a `mapPinOff` glyph, a `secondary-light` swatch, a button in the header rather
than under the map. The corrections are recorded above (item 14, and items 3
and 5 now that #1438 has landed), and the method note is this: **render both
and look at them.** The prototype is a self-contained runnable file; our own
components bundle against the app's compiled Tailwind in headless Chromium.
Anything claiming parity on a visual surface should carry a picture of both.

What that pass found beyond what was reported, all now built: the walk's
control row was missing the canvas's icons entirely (footprints for walking,
a car for driving, a repeat glyph for the loop, and a struck-through map pin
on the location switch — added to the styleguide barrel from `lucide-react`,
which is where the canvas's own set comes from); the per-leg time was
unstyled where the canvas prints it in `info` blue behind a footprints glyph;
a single-resident stop row closed on a bare status dot with no word beside it;
and the door panel's three header controls were filled primary circles where
the canvas draws plain glyphs. None of these appear in a markup diff.
