import { DIRECTIVE_FENCE } from './stepProtocol'
import type { PriorityFlowStep } from './steps'

// What each step asks the agent for, with the user's actual priority in it.
// These are sent hidden, so the user sees the answer and never the instruction.
//
// This is the step prompt's job done from the client, because the flow has no
// backend: each one is a miniature of its rule block in
// docs/serve-priority-flow-prompt.md. When gp-api owns the flow, these move
// server-side into the real prompt and the protocol below becomes tools, so
// keep each one faithful to its block rather than drifting into something
// easier to ask for.

const METHOD_MENU =
  'ordinance, resolution, budget, grant, staff direction, ' +
  'intergovernmental agreement, task force, partnership, community ' +
  'education, advocacy, plan, ballot measure'

// The interaction contract. The ordinance flow gets this from tools:
// ask_clarify_question renders a widget, save_synthesis settles the step,
// offer_next_step renders the Continue button. Here the agent is asked to end
// every turn with one fenced block and the client parses it (stepProtocol.ts).
// Without it a step is a monologue, which is what it was before.
const PROTOCOL = [
  'HOW TO END EVERY TURN. A step is a conversation, not a briefing. End every',
  'single turn with exactly one fenced block, and put nothing after it.',
  '',
  'To ask me something, which is what you should do until the step is settled:',
  '```' + DIRECTIVE_FENCE,
  '{"ask": "your question", "options": ["option", "option", "option"], "notes": ["why this one", "why this one", "why this one"]}',
  '```',
  'Two to four options, each a real choice I could pick, written the way I',
  'would say it. Notes are optional and positional: note i explains option i in',
  'one line. Ask ONE question per turn. Never write the question or its options',
  'in the prose as well, the block is what I see.',
  'Do not lead into the block either, in any shape. No "now, the first',
  'question", no "question one", no numbering, and no sentence that points at',
  'it ("here is the first thing I need to nail down", "so, first:"). The prose',
  'ends on the last thing you actually had to say, and the block carries the',
  'ask.',
  '',
  'When the step is genuinely settled, and only then:',
  '```' + DIRECTIVE_FENCE,
  '{"settled": "two or three sentences on what we decided here, in my words, so the next step can build on it", "outreach": {"who": "the group, as you found them in my contact data", "count": 260, "channel": "phone_banking", "why": "one line on why these people and this channel", "message": "the actual thing to say to them, ready for me to review"}}',
  '```',
  'Always include outreach when you settle, and do the work to make it real',
  'rather than asking me who to talk to. Before you settle: call',
  'describe_filter_dimensions, then count_contacts, to find the group in my',
  'actual contact data whose answer would confirm or break what we just',
  'agreed, and say how many there are. Pick the channel they are most likely',
  'to answer on ("phone_banking" for a conversation or an older group,',
  '"social" for reach and for people not in the file). Write the message',
  'itself: short, in my voice, one clear question.',
  'Include orgs too, one to three of them, whenever a real local',
  'organization would reach people my contact file will not, or would give',
  'me a better informed answer: a neighbourhood association, a tenants',
  'union, a business association, a service provider, an advocacy group',
  'already working this issue. Name real ones for my jurisdiction, look',
  'them up rather than inventing a plausible-sounding name, and say who to',
  'approach there and how. These are as much the answer as the direct',
  'outreach is, not a footnote to it.',
  'Never settle on the first turn of a step. Work it first.',
  '',
  'After you settle, your next turn asks whether to run it, with exactly these',
  'two options: "Yes, set it up" and "Skip it for now". If I skip, note in one',
  'line what goes unchecked and move on. If I say yes, create the list with',
  'crud_saved_filters (confirm the count first, name it for this priority),',
  'then hand off with nothing else in the turn:',
  '```' + DIRECTIVE_FENCE,
  '{"handoff": {"channel": "phone_banking", "listId": 123, "listName": "Flood blocks renters", "message": "the same message, final"}}',
  '```',
  'If the list cannot be created, hand off without listId and say so in the',
  'prose: I will pick the audience myself on the next screen.',
].join('\n')

const HOUSE_RULES =
  'Rules for this answer: be specific to my district and this priority, ' +
  'never invent a figure, a statute, or a citation, and say plainly when ' +
  'something is unverified and where I should confirm it. Advise me on ' +
  'method, not on what position to hold. Never print a modeled constituent ' +
  'score: it is a weighting between the two poles of an issue, not a grade ' +
  'out of 100, so give the direction and its strength in words instead. ' +
  'Write like a colleague who ' +
  'respects my time: lead with the answer, keep the prose under 150 words, ' +
  'no filler opener, no recap of what I asked, no caveats I did not ask ' +
  'for. However much research you do, the prose I see is at most three ' +
  'short paragraphs: put the rest into the options. Never narrate why ' +
  'something matters ("that is relevant context", ' +
  '"what this tells you is"): say the thing and stop. Talk about my ' +
  'neighbourhoods and the people who show up, not "the population" or "your ' +
  'coalition". No em-dashes: use a colon, comma, period, or parentheses.'

// Each step says what it has to settle and how much to ask before it can. The
// question count is a floor on interaction, not a script: a step that settles
// without asking anything is the failure this exists to prevent.
const STEP_ASKS: Record<PriorityFlowStep, string> = {
  intro:
    'Confirm in two sentences what you understand this priority to be, then ' +
    'ask whether that is right.',

  define:
    'STEP: defining the problem. What has to be settled is who this lands on ' +
    'hardest and what I would accept as solved. Ask about those one at a ' +
    'time, at least two questions, following up when an answer is vague. Do ' +
    'not accept a slogan as a definition of solved. Once both are answered, ' +
    'settle the step with the problem in my own words.',

  evidence:
    'STEP: what is already known. Open by telling me what is ESTABLISHED, ' +
    'what is LIKELY, and what is NOT KNOWN about this in my district, under ' +
    'those three headings. Work the sources I already have before the open ' +
    'web: the community issues listed above (read the relevant ones in full, ' +
    'they are synthesized and carry sources worth following), my district ' +
    'data, and what has come up in my meetings. Then search for what those ' +
    'leave open, and cite what you find. Be ' +
    'explicit about which of my claims would not survive a question from a ' +
    'colleague. Then ask which unknown is worth closing first, or which ' +
    'finding changes my mind. Settle once I have answered.',

  listen_problem:
    'STEP: who to hear from. Open with the two or three groups of my ' +
    'constituents this lands on hardest, roughly how many people each is, ' +
    'the most practical way to reach each one, and who is likely missing ' +
    'from my contact data. Then ask how I want to do it, with these as the ' +
    'options: run outreach now, record what I have already heard, do it but ' +
    'not yet, or move on without it. If I pick "not yet", ask when and what ' +
    'would trigger it. If I pick "move on", say once in two sentences what ' +
    'it costs me that nobody in the affected group was asked, then let it ' +
    'go. Settle with what was decided, naming any group left unheard.',

  options:
    'STEP: my options. Open with three to five realistic ways to act on ' +
    'this. For each: what it does in one line, who has to say yes, rough ' +
    'cost, rough time to effect, the main risk to me, and a jurisdiction ' +
    'that tried it with a source. Include one that failed somewhere and one ' +
    'that is smaller and cheaper than what I probably have in mind. These ' +
    'are approaches, not positions. Then ask which are worth keeping on the ' +
    'table, and follow up on what would have to be true for the one I lean ' +
    'toward. At least two questions before you settle.',

  listen_options:
    'STEP: input on the choice. Open with which groups whose answer would ' +
    'actually change the decision and the single question I should put to ' +
    'them. Then ask how I want to do it, with the same four options as ' +
    'before: run it now, record what I have heard, not yet, or move on ' +
    'without it. Handle "not yet" and "move on" the same way. Settle with ' +
    'what was decided.',

  method:
    'STEP: deciding how. Open with what my office can actually do: my ' +
    'authority including any state preemption, the funding path, and ' +
    'exactly who has to say yes. Search for the bar directly rather than ' +
    'concluding from not finding one, and cite what you find. If there is a ' +
    'hard stop, say so first and send me to my attorney. Then ask me to ' +
    `choose between one and three of these, ranked by you: ${METHOD_MENU}. ` +
    'Say which you would pick and why in a sentence before you ask. If I ' +
    'pick one you ranked lower, record it without arguing and note in one ' +
    'line the risk I am accepting. Settle with the chosen path.',

  plan:
    'STEP: the plan. Open with the next actions in order, each a thing a ' +
    'person does rather than a phase, with who does it and a date or a ' +
    'deadline to confirm. Name people by role, and where a deadline depends ' +
    'on the calendar make the action "confirm it with the clerk" rather ' +
    'than asserting a date. Then ask which action I will take first, or ' +
    'what I want to change. Settle with the plan as it stands after my ' +
    'answer.',

  track:
    'STEP: where this stands. Open with what has moved, what is stuck, and ' +
    'what I owe someone, leading with anything overdue. Then ask what to ' +
    'chase first, or whether I want a constituent update drafted. Settle ' +
    'with what I decided to do next.',
}

// The community issue feed is already synthesized research with sources
// attached, but the agent's read tool takes an id and it has no way to
// discover one. So the ids ride in the prompt, and the steps that research
// are told to read the ones that bear on this priority.
const issuesBlock = (issues: { id: string; title: string }[]): string | null =>
  issues.length === 0
    ? null
    : [
        'Community issues already on file for my district, with ids for',
        '`read_community_issues`. These carry a synthesized write-up and real',
        'sources, so read the ones that bear on this priority before you search',
        'the open web, and cite what they cite:',
        ...issues.map((i) => `- ${i.id}: ${i.title}`),
      ].join('\n')

// The steps that do research. The others do not need the feed and should not
// spend a tool call on it.
const RESEARCH_STEPS: PriorityFlowStep[] = [
  'evidence',
  'listen_problem',
  'options',
  'method',
]

export const buildStepPrompt = (
  step: PriorityFlowStep,
  priority: { title: string; description: string },
  issues: { id: string; title: string }[] = [],
): string => {
  const feed = RESEARCH_STEPS.includes(step) ? issuesBlock(issues) : null
  return [
    `My priority: "${priority.title}".`,
    `How I describe it: ${priority.description}`,
    ...(feed ? [feed] : []),
    STEP_ASKS[step],
    HOUSE_RULES,
    PROTOCOL,
  ].join('\n\n')
}
