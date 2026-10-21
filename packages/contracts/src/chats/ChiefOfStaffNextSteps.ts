// The turn the Chief of Staff intro sends, as the official's own message, when
// they pick more than one next step. gp-api's prompt recognizes it by the lead
// and works through the numbered steps in order, so both sides share it. The
// list stays in the transcript, which is how the agent remembers the steps it
// has not reached yet.
export const PICKED_NEXT_STEPS_LEAD = "Let's work through these, one at a time:"

export const pickedNextStepsMessage = (steps: string[]): string =>
  [PICKED_NEXT_STEPS_LEAD, ...steps.map((step, i) => `${i + 1}. ${step}`)].join(
    '\n',
  )
