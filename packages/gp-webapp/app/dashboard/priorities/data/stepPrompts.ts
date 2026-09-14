import { AFFECTEDNESS_METHOD } from './affectedness'
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
  'When the step is genuinely settled, say what we decided and nothing else.',
  'Two or three sentences, in my words, so I can check it before anything is',
  'built on it:',
  '```' + DIRECTIVE_FENCE,
  '{"settled": "what we decided here"}',
  '```',
  'Only the summary. Do not put the audience, the message or any',
  'organizations in this turn: I will ask for those next, in their own turns.',
  'Never settle on the first turn of a step. Work it first.',
  '',
  'NEVER NAME THE FORMAT. Do not say "here is the settled block", "the block',
  'below", "the card", or anything about how your answer is structured. I see',
  'rendered cards, not blocks, so talking about them reads as the plumbing',
  'showing through.',
  '',
  'When the step cannot be finished in this conversation because it needs',
  'something from the real world (a council meeting, an attorney, a staff',
  'report, outreach that takes two weeks to come back), do not settle and do',
  'not keep asking. Say so and record it:',
  '```' + DIRECTIVE_FENCE,
  '{"waiting": {"on": "the engineer estimate from public works", "unblocks": "what this step still needs it for", "when": "after the March 11 meeting"}}',
  '```',
  'That is how I get picked up where I left off, so be specific about what is',
  'outstanding and who owes it.',
].join('\n')

// The flow borrows the chief_of_staff scope, whose prompt is written for that
// surface's home: it opens a sitting, introduces itself, and leads with what
// changed since last time. Inside a priority, mid-task, all of that is noise,
// so every step ask opens by saying where the user already is.
//
// This is the client fighting a server prompt, which is the wrong place for
// it. The durable fix is a `priority` chat anchor that gp-api reads to drop
// the onboarding, session-opener and first-run blocks, and it lands with the
// priority_flow scope.
const FLOW_CONTEXT =
  'Context: I am not opening a session with you. I am already inside the ' +
  'Priorities flow, on this one priority, mid-task, and I can see the step ' +
  'I am on. Do not greet me, do not introduce yourself, do not summarize my ' +
  'priorities or what has changed since last time, and do not tell me what ' +
  'we are about to do. Start on the work of this step.'

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
  'short paragraphs: put the rest into the options. When you call tools ' +
  'partway through a turn, carry on from where you left off rather than ' +
  'restating what you already told me: I can see it above, and reading it ' +
  'twice looks like a bug. Never narrate why ' +
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

// Each step ask carries a marker the client reads back off a resumed
// transcript to work out which step the conversation is on. It sits in the
// hidden prompt, so the user never sees it, and it is the only durable record
// of the step until gp-api owns the flow.
export const STEP_MARKER = (step: PriorityFlowStep): string => `[step:${step}]`

export const stepFromMarker = (
  text: string,
  steps: readonly PriorityFlowStep[],
): PriorityFlowStep | null => {
  const match = text.match(/\[step:([a-z_]+)\]/)
  const found = match?.[1]
  return found && (steps as readonly string[]).includes(found)
    ? (found as PriorityFlowStep)
    : null
}

// Sent on returning to a priority whose last turn was waiting on something
// outside the app. The nudge is the point of recording it.
export const buildResumePrompt = (waitingOn: string): string =>
  [
    `I am back. Last time we were waiting on: ${waitingOn}`,
    'Open by asking how that went, in one short line, and give me options ' +
      'that cover it having happened, not having happened yet, and having ' +
      'changed. Do not re-run the step or repeat what we already settled.',
    HOUSE_RULES,
    PROTOCOL,
  ].join('\n\n')

// The beats that follow a confirmed summary. The client asks for them in
// order rather than trusting the agent to volunteer three turns: left to
// itself it collapsed them into one, skipped the summary, and never got to
// the organizations at all.
export const buildOutreachPrompt = (settled: string): string =>
  [
    `I confirmed the summary: ${settled}`,
    'Now the outreach, and do the work before you answer rather than ' +
      'proposing it: find the group in my real contact data whose answer ' +
      'would confirm or break what we settled, by the method below; ' +
      'crud_saved_filters to actually create that list, named for this ' +
      'priority; then pick the channel they are likeliest to answer on ' +
      '("phone_banking" for a conversation or an older group, "social" for ' +
      'reach and for people not in the file) and write the message itself, ' +
      'short, in my voice, one clear question.',
    AFFECTEDNESS_METHOD,
    'End the turn with exactly this and nothing else:',
    '```' +
      DIRECTIVE_FENCE +
      '\n{"outreach": {"who": "the group, as you found them in my contact data", "count": 260, "channel": "phone_banking", "why": "one line on why these people and this channel", "message": "the message", "listId": 123, "listName": "the list you created", "campaignName": "what to call this outreach in my history"}}\n```',
    'If the list cannot be built, leave listId out and say why in one line. ' +
      'One or two lines of prose at most: the card carries it.',
    HOUSE_RULES,
  ].join('\n\n')

export const buildOrgsPrompt = (settled: string): string =>
  [
    `Still on: ${settled}`,
    'Now the organizations, one to three, whose help is worth having on ' +
      'this: a neighbourhood association, a tenants union, a business ' +
      'association, a service provider, an advocacy group already working ' +
      'it, a local newsroom that covers it. Pick ones that reach people my ' +
      'contact file will not, or that would give me a better informed ' +
      'answer. Look them up. Never invent a name or a contact detail: an ' +
      'address that does not exist is worse than none.',
    'End the turn with exactly this and nothing else:',
    '```' +
      DIRECTIVE_FENCE +
      '\n{"orgs": [{"name": "the organization", "why": "who they reach that my contact file does not", "askFor": "who to ask for there", "script": "what I actually say to them, ready to send", "email": "their real address", "phone": "their real number", "url": "their page"}]}\n```',
    'askFor and script are required on every one. The script is what I send ' +
      'or read out, in my voice, saying what I want from them. One or two ' +
      'lines of prose at most.',
    HOUSE_RULES,
  ].join('\n\n')

// Sent when a turn ended in a block the client could not read. The prose in
// that turn almost always points at a card ("the three groups below"), so
// silence is the one thing this cannot do.
export const buildRepairPrompt = (): string =>
  [
    'That last block did not come through: I see your message but no card.',
    'Send the block again on its own, with nothing before or after it, in ' +
      'exactly the shape the instructions gave. Check that every field is ' +
      'present, that the JSON is valid, and that strings with quotes or ' +
      'newlines in them are escaped. Do not rewrite what you said, and do ' +
      'not apologise: just the block.',
  ].join('\n\n')

export const buildStepPrompt = (
  step: PriorityFlowStep,
  priority: { title: string; description: string },
  issues: { id: string; title: string }[] = [],
  // Only when the API refused the priority anchor, which is the signal that
  // its prompt does not yet know this flow exists. Once every environment is
  // on an anchor-aware gp-api, this and FLOW_CONTEXT both go.
  opts: { declareFlowContext?: boolean } = {},
): string => {
  const feed = RESEARCH_STEPS.includes(step) ? issuesBlock(issues) : null
  return [
    STEP_MARKER(step),
    ...(opts.declareFlowContext ? [FLOW_CONTEXT] : []),
    `My priority: "${priority.title}".`,
    `How I describe it: ${priority.description}`,
    ...(feed ? [feed] : []),
    STEP_ASKS[step],
    HOUSE_RULES,
    PROTOCOL,
  ].join('\n\n')
}
