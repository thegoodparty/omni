# Review lens: the questions the page has to answer

These are the questions our head of product asks in every design review. The page
answers them before anyone has to ask. Use them twice: to write the brief at the
top of the page (step 2), and as the checklist for the review round (step 6).

When the ticket, the code or the data can't answer a question, write "Unknown" on
the page and put the question in the comment you post back. Never invent a number.

## 1. Who are we designing for?

- What specific user problem does this solve? Answer this before looking at any
  solution. If you can't, the page isn't ready.
- Where do users come from when they reach this, and what do they expect when they
  arrive? This is the entry point every option starts on.
- What device? What is the phone and desktop split? (Amplitude, if you have it.)
- Is this a design problem at all, or a product or marketing problem? They have
  different fixes. If it isn't a design problem, say so in the post-back.

## 2. What are we proposing?

- Are the three options meaningfully different in how they answer the question?
  Two options that differ only in their container (a side sheet and a full page, a
  modal and a new route) are one option. Replace one of them.
- What happens before and after these screens? Which emails, texts or
  notifications does each option trigger? A screen is almost never the end of the
  journey.
- What cheap variants are worth testing later (copy length, color, photo or
  illustration)? List them in the post-back, not on the page.

## 3. How will we measure success?

- What metric are we trying to move?
- What is the primary call to action, and which secondary actions also count as
  success?
- Is there a current version, and what are its baseline numbers (bounce, scroll
  depth, completion)? If scroll depth is low, content below the fold barely counts.

## 4. When will we know?

- How long until we know which option worked? Could we know faster with a shorter
  test window?

## Presentation

- Phone first, with the fold marked.
- Show today's screen before the change, where it helps.
- Cover UI that isn't up for feedback with a labeled gray block.
- Say what feedback we want today, and the context someone needs to give it.
- Open with the elevator summary: user, problem, solution, data and measurement,
  one sentence each.

## The design itself

Check every option against `docs/design-memory/learned.md`, especially:

- Can every heading and step indicator be read in a second? (rule 33)
- Are lists of six or more grouped and named? (rule 34)
- Does it show the top one to three things and let people go deeper? (rule 35)
- Is the value said in dollars or outcomes where the user decides to pay or
  commit? (rule 32)
- Are buttons on the right, and does the stepper fit the flow? (rules 37 and 38)
- Small type, low contrast, or a flow only a technical user would get through are
  accessibility problems. Fix them.
