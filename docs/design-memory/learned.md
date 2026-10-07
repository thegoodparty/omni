# Learned rules

Every rule here exists because someone had to give the correction at least once.
Apply all of them on the first pass.

**Session log:** seeded 2026-09-08 from existing GoodParty briefs and process docs.
Entries marked `(seeded)` were inferred from written conventions rather than earned
from a real correction. Delete any that turn out to be wrong. That is expected.
Entries marked `(earned)` came from corrections in product design sessions, first
captured 2026-10-07 from the candidate Home and Game Plan work.

---

## Copy

1. Plain US English. Short sentences. If a candidate or a part-time council member
   would not say it out loud, rewrite it. (seeded)
2. No em dashes. Ever. (seeded)
3. No emoji. (seeded)
4. Sentence case for every heading, label, button, and nav item. Not title case. (seeded)
5. Call them agents, never chatbots. (seeded)
6. Write in the user's voice, not the product's. A generated summary should read
   like the official wrote it, not like software describing itself. (seeded)
17. Do not repeat the same helper line under every field or question. If each one
    carries the same sentence, it says nothing; cut it and let the question and
    its example do the work. (earned)
18. A tag or label earns its place by saying something true and specific to this
    item, like a real deadline. Labels that would show on every visit ("Start
    here", "High priority") are noise. (earned)

## Content

7. Use the fixtures in `fixtures.md`. Do not invent a new city, persona, or data
   set for each design. Recurring characters make review faster. (seeded)
8. Hardcode at least one example end to end. A design where every card says
   "Lorem ipsum" cannot be reviewed for whether the concept works. (seeded)
9. Anchor comparisons to similar-size local jurisdictions, never national averages.
   A town of 32,000 does not care what the national median is. (seeded)
10. Every factual claim carries a visible inline citation. Sources are shown, not
    hidden behind a click. (seeded)

## Hierarchy

11. The user already knows their priorities. The agent does research and
    translation, it does not generate opinions or tell them what to care about. (seeded)
12. Show a working set, not a backlog. Cap the visible list and collapse the rest,
    so the design makes a point about focus. (seeded)
13. Anything generated gets a correction affordance: thumbs up and down plus an
    open text field. (seeded)
14. Output that someone would take into a meeting must be printable. (seeded)
19. No overlines. Do not put a small uppercase label above a heading or card
    title. We were using them everywhere and they stopped meaning anything; the
    title leads. (earned)
20. Card and section titles sit below the page title in size and weight. A
    question on a form page is a label, not a second page title. (earned)

## Form

15. Reuse the existing product family shell. Header, nav, card styling, typography,
    and the right-side source drawer should be identical across features so it
    reads as one product. (seeded)
16. Light theme, generous whitespace, clean and trustworthy over clever. (seeded)
21. Borders, not shadows, on cards, trays and inputs. Related surfaces share the
    same corner radius. (earned)
22. Body and input text is 16px. Do not let a component shrink it to 14px. (earned)
23. Text areas look the same everywhere. The outreach compose card is the
    reference: the field sits seamless inside the card, with a full-width footer
    under a rule holding quiet ghost actions (Improve with AI, the mic). (earned)
24. Every icon-only button gets a tooltip that says what it does. (earned)
25. A dashed "add" control is a button, so it gets a white fill and a link-blue
    dashed border, not a gray one that reads as an empty slot. (earned)
26. Leave about 128px of space after the last element on a long page, so the end
    reads as the end. (earned)
27. A page you step into and back out of (a story, a profile) drops the sidebar
    and opens on a back arrow and its title. The back arrow sits in the margin,
    so the title lines up with the content under it. (earned)

---

## Retired

Rules that were tried and did not hold up. Kept briefly so they are not
re-proposed, then deleted.

*(none yet)*
