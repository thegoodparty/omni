// The unresolved question from the Friday call: what is the relationship
// between a priority's own surface and the Chief of Staff chat?
//
// Every shell gets the SAME question put to Chief of Staff, so the answer is
// the comparison. What changes between them is how much this surface can see,
// and whether the work can continue here or only over in the feature.

export type Continuity =
  /** Borrowed scope. The flow's thread lands in this history, unlabelled. */
  | 'same-thread'
  /** Reads the shared state, does not run the work. */
  | 'reads'
  /** Genuinely unsettled: both surfaces want to host the conversation. */
  | 'contested'
  /** No relationship to design, because there is only one surface. */
  | 'is-the-surface'

export type ChiefOfStaffRelation = {
  /** What Chief of Staff replies to "Where are we on Maple Ave?" */
  answer: string
  knows: string[]
  blind: string[]
  continuity: Continuity
  verdict: string
}

export const THE_QUESTION = 'Where are we on Maple Ave?'

export const CONTINUITY_LABEL: Record<Continuity, string> = {
  'same-thread': 'Shares this history, cannot read it',
  reads: 'Reads the state, does not run the work',
  contested: 'Both surfaces want to host this',
  'is-the-surface': 'This is the surface',
}

export const RELATIONS: Record<string, ChiefOfStaffRelation> = {
  stepper: {
    answer:
      'You have three priorities and Maple Ave is one of them, added on 15 September with no target date. I do not have a read on where it stands. Tell me where you got to and I will pick it up from there.',
    knows: ['The title and how you described it', 'That it is private'],
    blind: [
      'Which step the flow is on',
      'What any step settled',
      'That outreach went out to 312 households',
    ],
    continuity: 'same-thread',
    verdict:
      'Same chat scope, no shared state. The flow runs on this surface’s plumbing, so its thread sits in your history here with no label, and this surface still cannot read what the flow settled. You would repeat yourself.',
  },
  dossier: {
    answer:
      'Seven of the eight sections are settled. The one that matters is authority, and it is unchecked: it gates the method, so nothing downstream can move. Ask your attorney who owns the calming standard on Maple, and the options open up.',
    knows: [
      'Every section and whether it is settled',
      'Which section is blocking',
      'What the outreach asked and that nothing is back',
    ],
    blind: ['Nothing it needs for this answer'],
    continuity: 'reads',
    verdict:
      'The cleanest split of the six. The case file is the shared state, so this surface can answer precisely without running any of the work. One place to do it, one place to ask about it.',
  },
  gates: {
    answer:
      'You have the problem and you have who it lands on. Outreach is out and nothing is back yet. What is actually blocking you is authority, and the two conditions behind it are both waiting on that one answer.',
    knows: [
      'Which conditions are settled',
      'Which one is blocking',
      'What is waiting on what',
    ],
    blind: ['The detail behind each condition, unless you ask for it'],
    continuity: 'reads',
    verdict:
      'Works as well as the dossier and says less. Conditions are a small enough state that this surface can always name the next move in one line, which is exactly what you want from a chat.',
  },
  'check-in': {
    answer:
      'Your last check-in was this morning. You asked me to price the capital route first, and I said I would come back with numbers. I have them now. Do you want them here, or should I put them in the next check-in?',
    knows: [
      'Every check-in and what you decided',
      'What it owes you next',
      'Everything, because it is the same conversation',
    ],
    blind: ['Nothing, and that is the problem'],
    continuity: 'contested',
    verdict:
      'The blurriest of the six, and the one worth deciding deliberately. A check-in is already a conversation, so either this surface hosts them and Priorities collapses to an index, or you have two threads about one priority and neither is canonical.',
  },
  'next-action': {
    answer:
      'One thing: ask the manager to direct the speed study. The attorney confirmed the city owns the standard, so it needs no vote and no agenda slot. That is the whole list for Maple right now.',
    knows: [
      'The one next action and why it is next',
      'What has already been cleared',
    ],
    blind: ['The full reasoning, until you ask for it'],
    continuity: 'reads',
    verdict:
      'A natural pairing. The list is the glance and this surface is the why, so the two do different jobs on the same state and nothing is duplicated.',
  },
  capability: {
    answer:
      'You are already here, and this thread is the whole record. I have the walk zone sized and the speed count read. The open question is authority, and the method follows from it. Ask your attorney and I will price whatever survives.',
    knows: ['Everything, because there is nowhere else'],
    blind: ['Nothing'],
    continuity: 'is-the-surface',
    verdict:
      'There is no relationship to design, which is the whole argument for it. Priorities is something this surface holds rather than somewhere else you go, so the question the other five have to answer does not arise.',
  },
}
