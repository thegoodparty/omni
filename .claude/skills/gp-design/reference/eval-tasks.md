# Eval tasks

A fixed set of tasks to rerun after any change to `gp-design` or
`ux-review-options` (its text, templates, CSS or scripts). The same tasks every
time, so a change shows up as a difference between two runs, not as a new
task's quirks.

## The tasks

Run each as a full `gp-design` run in its own scratch folder,
`<work>/eval-<n>-<date>/`, outside the repo, and don't publish or post.

1. **Email editor.** ClickUp `17tnw2bgd47`, one design, with this direction
   from the designer, binding:
   - Rework the existing templates into one template. Inside it: a color
     choice (about three) and a built-in photo.
   - The editor feels like a very simple classic email newsletter builder: the
     email itself is the canvas, with placeholder blocks filled in place
     (photo, headline, message, a button with text and link or removed, an
     optional profile link). No on/off switches for blocks.
   - Tone of voice comes first in the editor, before the text: it is the
     input the AI draft is written from.
   - An Editor / Preview switch; Preview has phone and desktop.
   - "Send a test to myself" is on the editor screen and on the ready-to-send
     (review) step.
   - Text inside the email is left-aligned by default.
   - The flow clicks through in the phone frame and in Desktop preview at
     1280 (`?view=desktop`).
2. **Win Pro upgrade.** One design: the Pro upgrade screen a Win candidate
   reaches from the upgrade banner on the dashboard.
3. **Serve meeting briefing.** One design: the screen where an elected
   official reviews a meeting briefing before the meeting.
4. **Win onboarding step.** Three options for one Win onboarding step.

## Pass

A task passes when all three hold:

- `scripts/check.py` with no flag prints `ok` (or with `--skip-build-shape`
  when the run wrote `no-build-shape.txt`).
- The senior design review (`senior-review.md`) returns no Do in list A
  after the fixes.
- Every clause of the direction is delivered on the page, or listed in
  `#<x>-drops` or "Decisions needed". Tasks 2 to 4 have no direction: the
  ticket or the one-line ask stands in for it.

## Compare with the last run

Keep each run's folder. For each task, put the new run next to the previous
one and write down:

- Pass or fail on each of the three, then and now.
- The count of Do, Consider and Nit in the senior review, then and now, and
  any Do that is new.
- The count of mutations in each `#<x>-mutations`, and any new
  "no-component" row.
- Screenshots of the same screens side by side at 375 and 1280.

A change to the skill lands only when no task goes from pass to fail and the
review counts don't rise. Put the comparison in the PR body.
