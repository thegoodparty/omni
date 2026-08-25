# Door knocking vs the Voter Outreach 2.0 canvas

An independent audit of the four rebuilt door-knocking surfaces against the
canvas prototype (`Voter Outreach.dc.html`, the door-knocking region at lines
5289–5838). It is written to be read without opening any code: for each
difference, what the canvas does, what we do, and which of three piles it falls
in.

- **Fixed in this PR** — the canvas had it, we had drifted or never built it,
  and adopting it was unambiguous. 6 items.
- **Deliberate, and still right** — we depart on purpose, the reasoning is on
  record, and I re-checked that it still holds. Nothing changed. 18 items.
- **Needs a product answer** — a real difference that is somebody's decision,
  not an engineer's. 8 items.

**32 differences total.** The build is close to the canvas. Most of what looks
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

It is worth saying what this is *not*. The walk's auto-advance is still
forward-only, and deliberately: it moves the canvasser without being asked, and
sending them back up a street they have already walked is exactly what it must
never do. These chevrons are asked for.

---

## Fixed in this PR

### 1. Door-to-door navigation in the door panel

Above. The most substantive item in this audit.

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
by colour and a thin ring alone.

### 5. The list details drawer never said what state the list was in

The canvas draws a status indicator beside the name in **both** details drawers
(`renderDkDetails`: `statusIndicator(list.completed?'done':(knocked>0?
'in-progress':'scheduled'))`). Our outreach history drawer has always rendered
one; the door-knocking drawer rendered nothing. So a candidate could open Details
on a finished list and find nothing on the surface that knew it was finished —
the footer's "Move to archive" button was the only clue.

It now renders the same component the outreach drawer does, so one saved list is
described in one vocabulary from both entry points: **Scheduled** before it is
knocked, **In progress** once it has a route, **Done**, **Archived**. (Archived
is ours — the canvas has no shelf, and "Done" would be a lie about a list the
rail has taken off the active section.)

### 6. Two small copy items

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
small backend change" (§ *Still open*, item on `doorCount`); this audit is the
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

### 3. The confirm step has no picture of what you drew

**Canvas:** a 192px map at the top of the confirm step showing the selected
voters and the polygon, tinted in the colour being chosen just below it.

**Ours:** no map on that step — the sheet is full height and covers the page's
map. The concrete cost is the colour picker: it asks a candidate to choose the
colour their list will be drawn in on the map, with the map hidden. The stats
line ("N doors · N stops · N voters") is the only description of the shape.

**Why it isn't just fixed:** it needs a second map instance in a sheet, or the
confirm sheet made partly transparent the way the who step's is. Both are real
design decisions rather than a copy fix.

### 4. The details drawer has no breakdown of how the walk went

**Canvas:** a status breakdown table on the details drawer — each of the seven
canvass statuses with a count and a percentage — in the door-knocking drawer and
in the outreach history drawer.

**Ours:** one figure, "People logged — 34 of 61 · 56%", with a bar.

This is where I want to **question a recorded ruling**, per the brief.
`UI-DRIFT-REVIEW.md` **§6** rules the breakdown out because "its 'support'
breakdown is the landing rail's seven canvass-status chips [...] reporting the
same seven numbers again in a second visual form on a surface opened from that
rail is how two presentations of one quantity start disagreeing."

I think the premise no longer holds for a **knocked** list, for two reasons:

- They are not the same numbers. The rail's chips are computed from the voter
  pack over the list's polygon and filters — a superset, which the rail itself
  labels "About". A knocked list's outcomes come from its frozen route and are
  exact. Two different quantities that legitimately differ, which is the
  opposite of the failure §6 guards against.
- They are not the same scope. Details can be opened on a list that is not the
  selected one, in which case the rail's chips describe some other list entirely.

So a candidate who wants to know how a finished walk actually went — how many
doors were refusals, how many nobody was home — can currently only get it by
re-entering the walk. I have **not** built it, because §6 is a recorded decision
and this is the argument against it, not a licence to overturn it.

### 5. Which button should the confirm step lead with?

**Canvas:** the primary button is "Save and draw another"; "Save and exit" is
the outline one beside it.

**Ours:** exactly inverted — "Save and exit" is primary.

Both buttons exist and do the same two things either way; what differs is which
one the flow presents as the expected next move. The canvas assumes a candidate
cutting several nights of walking in one sitting. Ours assumes one list at a
time. That is a product intent question, so it is untouched.

### 6. The panel's "Voter support" card

The canvas panel carries a card stating the resident's current support level and
whether they will vote. We ask both questions in the knock form and store both
answers, and they appear in the activity feed with a date and an author — but
there is no card stating them as current facts. Our version is arguably the
more honest presentation (an answer given in June and an answer given in October
are different things), but the canvas's is a real difference and it is the same
family of question as the previous review's still-open item on how much of the
voter file a canvasser should see before knocking.

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
4. **Party and age only in the audience breakdown.** Recorded, §6 — and the
   canvas's "top issues" group is still data we do not hold.
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
   feature is that the gap is the preview's, never the filter's. *(Newly
   recorded — this was not written down before.)*
9. **"Continue (N doors)" rather than "Add to saved lists (N)"** on the draw
   step. The canvas's own handler does not save there either; it opens the
   confirm step, exactly as ours does. Adopting that label would promise a write
   that does not happen.
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

14. **A single-colour progress bar** rather than the canvas's segmented one, with
    the per-outcome counts printed underneath. Recorded, § B.
15. **Read-only travel-mode and loop chips** in the walk. The route is frozen;
    the mode it was bought for cannot be changed from inside it. (The details
    drawer does let you *read* the figure in the other mode, which the canvas
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
- **The door panel.** Bottom sheet under `lg`, right-hand panel above it, same as
  the canvas. The panel is 430px wide against the canvas's 448px; not worth a
  change.
- **The new chevrons** are full `IconButton` hit targets at the top of the panel,
  where a thumb reaches, rather than inline text links.
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

## Print

Not audited and not touched — another agent owns those surfaces. One thing to
pass on: the canvas's walk kebab offers a PDF download from inside the walk. We
offer "Print list" there, and the PDF from the rail card and the details drawer.
Reported, not fixed.

---

## What I verified against, and what I did not

The canvas region audited is lines 5289–5838 of `Voter Outreach.dc.html`:
`renderWorklist`, `renderPanel`, `renderDkDetails`, `renderDoorKnocking`,
`dkListCard`, `dkLegend`, `dkMap`, `renderDkFlow`, `dkFooter`, `dkStepPurpose`,
`dkStepWho`, `dkStepName`, `dkStepDraw`, `dkStepConfirm` and `renderDkDelete`.
I did not review the ~640 screenshots in `uploads/`, the phone-banking and SMS
regions, or the canvas's Pro paywall gate (`proGate`), which is a billing flow
rather than a door-knocking surface.
