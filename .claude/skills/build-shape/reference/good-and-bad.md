# What a good build shape looks like

## The test

A reviewer opens the page and, within two minutes, can answer:

1. What does each option build on, and what does it add?
2. How does each option handle the hard part?
3. Is there an obvious foundation none of the options uses?
4. Which option would I pick, and what would I push back on?

If any of these needs more than two minutes, the page is too long or too vague.

## Good

- The maps carry the page. A reviewer can skip most of the text.
- Each deployed system is a container, and its parts sit inside it.
- New parts stand out at a glance; unchanged parts recede and take little room.
- Most of each map is about what is new or changed.
- Every label makes sense to someone who has two minutes.
- Map text is as readable as body text.
- Options differ in what they stand on, not in how they are coded.
- Managed services on platforms we already pay for are considered as foundations,
  even when we have not used them yet.
- Every option says how it handles the hard part of this kind of system.
- Known limits are named where an option leans on them.
- Every option is one a senior engineer would defend.
- One option questions the premise: it drops or defers the costliest requirement, or
  does the job the way it is already done today, when that is credible.
- Risks name what existing behavior the option sets off or breaks.

## Bad

- Any wall of text, including inventories of what exists. Research stays in your
  head; only options reach the page.
- Options laid out side by side in columns.
- Small text inside diagrams.
- Maps that spend most of their area on unchanged paved paths.
- Cryptic detail lines and internal shorthand.
- Boxes floating loose when they live in the same system.
- Schema, field lists, endpoint tables, code.
- Options that differ by library, naming or table layout.
- A filler option, for example a manual fallback no one would choose, added to
  reach three.
- Ignoring the hard part of this kind of system.
- Leaning on a slow or rate-limited part without saying so.
- New access, auth models, tables or services without saying why the way the job
  is done today cannot work.
- A recommendation, a ranking, or an option written to lose.
