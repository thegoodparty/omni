import type { PriorityFlowStep } from './steps'

// What each step asks the agent for, with the user's actual priority in it.
// These are sent hidden, so the user sees the answer and never the instruction.
//
// This is the step prompt's job done from the client, because the flow has no
// backend: each one is a miniature of its rule block in
// docs/serve-priority-flow-prompt.md. When gp-api owns the flow, these move
// server-side into the real prompt and this file goes away, so keep each one
// faithful to its block rather than drifting into something easier to ask for.

const METHOD_MENU =
  'ordinance, resolution, budget, grant, staff direction, ' +
  'intergovernmental agreement, task force, partnership, community ' +
  'education, advocacy, plan, ballot measure'

// The same house voice gp-api's prompts carry (src/ai/prompt/voiceBlocks.ts),
// said in one paragraph because this rides a general agent that has no flow
// prompt of its own. Keep the two in step: if the shared blocks change, this
// changes.
const HOUSE_RULES =
  'Rules for this answer: be specific to my district and this priority, ' +
  'never invent a figure, a statute, or a citation, and say plainly when ' +
  'something is unverified and where I should confirm it. Advise me on ' +
  'method, not on what position to hold. Write like a colleague who ' +
  'respects my time: lead with the answer, keep it under 200 words, no ' +
  'filler opener, no recap of what I asked, no caveats I did not ask for. ' +
  'End on something I can act on or one question worth answering, never a ' +
  'dead end. If the answer covers several distinct things, break it into ' +
  'short sections with a two-to-four word sentence-case label alone on its ' +
  'line as a markdown heading. No em-dashes: use a colon, comma, period, ' +
  'or parentheses.'

const STEP_ASKS: Record<PriorityFlowStep, string> = {
  intro:
    'Confirm back to me in two sentences what you understand this priority ' +
    'to be, then ask if that is right.',

  define:
    'We are defining the problem. Ask me the ONE question that would most ' +
    'sharpen what the problem actually is, and offer three short concrete ' +
    'options I can pick from as a numbered list. Ask one question only, and ' +
    'do not answer it yourself. The question I most need to settle is who ' +
    'this lands on and what I would accept as solved.',

  evidence:
    'We are grounding this in what is already known. Tell me what is ' +
    'ESTABLISHED, what is LIKELY, and what is NOT KNOWN about this in my ' +
    'district, under those three headings. Use my district data, what has ' +
    'come up in my meetings, and anything you can look up, and cite what you ' +
    'find. Be explicit about which of my claims would not survive a question ' +
    'from a colleague.',

  listen_problem:
    'We are working out who I should hear from before any solution is on the ' +
    'table. Name the two or three groups of my constituents this lands on ' +
    'hardest, roughly how many people each is, and the most practical way to ' +
    'reach each one. Then name who is likely missing from my contact data ' +
    'and how I would actually reach them. Finish by asking whether I want to ' +
    'run outreach now, record what I have already heard, or come back to it.',

  options:
    'We are looking at my options. Give me three to five realistic ways to ' +
    'act on this. For each: what it does in one line, who has to say yes, ' +
    'rough cost, rough time to effect, the main risk to me, and a ' +
    'jurisdiction that tried it with a source. Include one that failed ' +
    'somewhere and one that is smaller and cheaper than what I probably have ' +
    'in mind. These are approaches, not positions.',

  listen_options:
    'We are getting constituent input on the choice. Given the options on the ' +
    'table, tell me which groups whose answer would actually change my ' +
    'decision, the single question I should put to them, and how to reach ' +
    'them. Then ask whether I want to run it, record what I have heard, or ' +
    'come back to it.',

  method:
    'We are deciding how to act. First check what my office can actually do: ' +
    'my authority including any state preemption, the funding path, and ' +
    'exactly who has to say yes. Search for the bar directly rather than ' +
    'concluding from not finding one, and cite what you find. If there is a ' +
    'hard stop, say so first and send me to my attorney. Then recommend one ' +
    `to three of these, ranked: ${METHOD_MENU}. Say which you would pick and ` +
    'why in a sentence or two.',

  plan:
    'We are turning the decision into the actual legwork. Give me the next ' +
    'actions in order, each one a thing a person does rather than a phase, ' +
    'with who does it and a date or a deadline to confirm. Name people by ' +
    'role, and where a deadline depends on the calendar make the action ' +
    '"confirm it with the clerk" rather than asserting a date.',

  track:
    'Tell me where this stands: what has moved, what is stuck, and what I owe ' +
    'someone. Lead with anything overdue. Then offer a short plain-language ' +
    'update I could send constituents about it.',
}

export const buildStepPrompt = (
  step: PriorityFlowStep,
  priority: { title: string; description: string },
): string =>
  [
    `My priority: "${priority.title}".`,
    `How I describe it: ${priority.description}`,
    STEP_ASKS[step],
    HOUSE_RULES,
  ].join('\n\n')
