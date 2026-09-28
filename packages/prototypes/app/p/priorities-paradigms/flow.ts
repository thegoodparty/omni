// The walkable script. Everything here exists so a shell can be moved FORWARD
// rather than posed: seven steps for the stepper, follow-on turns for the two
// chat shells, an action queue for the list, and later check-ins for the
// session shell. Content is the same Maple Ave priority throughout.

import type { NextAction, Session } from './data'

export type StepQuestion = {
  ask: string
  options: { label: string; note: string }[]
}

export type OutreachBeat = {
  who: string
  count: number
  channel: string
  message: string
}

export type FlowStep = {
  id: string
  stage: string
  short: string
  /** The flow's own opening bubble: a question the user can answer. */
  opener: { title: string; caption: string }
  /** What the agent says before it asks anything. */
  prose: string
  /** Asked in order. Every step asks at least once before it can settle. */
  questions: StepQuestion[]
  settled: string
  outreach: OutreachBeat
  orgs: { name: string; why: string }[]
}

export const FLOW_STEPS: FlowStep[] = [
  {
    id: 'define',
    stage: 'Understand it',
    short: 'The problem',
    opener: {
      title: "Let's get the shape of this",
      caption: 'A few questions, so we both know what solving this looks like.',
    },
    prose:
      'Maple Ave carries the school traffic, so who this lands on depends a lot on which part of the day you mean. I pulled what your district data says about that stretch before asking.',
    questions: [
      {
        ask: 'Who is this landing on hardest right now?',
        options: [
          {
            label: 'Families walking kids to the elementary school',
            note: 'About 340 households sit inside the walk zone, exposed twice a day on a fixed schedule.',
          },
          {
            label: 'Everyone who lives on the corridor itself',
            note: 'Roughly 180 households front Maple. They carry it all day, not just at pickup.',
          },
          {
            label: 'Drivers cutting through from the highway',
            note: 'That is who causes it rather than who it happens to, so it points at a different fix.',
          },
        ],
      },
      {
        ask: 'What would you accept as this being solved?',
        options: [
          {
            label: 'Measured speeds drop to the posted limit at pickup',
            note: 'The one you can measure before and after, which is what a colleague will ask you for.',
          },
          {
            label: 'No more near misses reported at the crossing',
            note: 'Honest goal, but near misses are self reported and your baseline is whoever called in.',
          },
          {
            label: 'Physical calming is in the ground on that block',
            note: 'That is a method, not an outcome. It decides the answer before you have asked the question.',
          },
        ],
      },
    ],
    settled:
      'Cars run above the posted limit through the elementary school walk zone at pickup. It lands hardest on the roughly 340 households inside that zone. Solved means measured speeds at the crossing come down to the posted limit, against a baseline you take first.',
    outreach: {
      who: 'Households inside the Maple Ave school walk zone',
      count: 312,
      channel: 'Social media',
      message:
        "I'm looking at speeding on Maple Ave by the elementary school. If you walk that stretch, tell me where it actually feels unsafe: at the crossing, or further down the block.",
    },
    orgs: [
      {
        name: 'Maple Elementary PTA',
        why: 'Reaches every family at the school, including renters your contact file does not hold.',
      },
      {
        name: 'Cheyenne Safe Streets Coalition',
        why: 'Has taken speed counts on three other corridors and can tell you what a defensible baseline looks like.',
      },
    ],
  },
  {
    id: 'evidence',
    stage: 'Understand it',
    short: 'What we know',
    opener: {
      title: "Let's see what we already know",
      caption:
        'What your data and the public record say, and where it is thin.',
    },
    prose:
      'Established: 340 households inside the walk zone, and Maple is a city street, so it is yours to act on. Likely: pickup is the peak, based on when complaints cluster, but nobody has measured it. Not known: actual speeds. There is no count on this corridor, and that is the claim a colleague will press first.',
    questions: [
      {
        ask: 'Which unknown is worth closing first?',
        options: [
          {
            label: 'Get an actual speed count on the corridor',
            note: 'Without it every number you bring is an estimate, and you will be asked for it.',
          },
          {
            label: 'Find what the last three calming projects cost the city',
            note: 'Useful for the budget conversation, but it does not tell you whether there is a problem.',
          },
          {
            label: 'Check whether the state has a safe-routes program open',
            note: 'Worth knowing, though the application window matters more than the answer right now.',
          },
        ],
      },
    ],
    settled:
      'The case rests on speed, and there is no speed data yet. Public Works owns the counter, so the first real move is asking them for a count at pickup. The cost comparables and the grant window can wait.',
    outreach: {
      who: 'Residents who have already complained about Maple',
      count: 48,
      channel: 'Phone banking',
      message:
        'You contacted the office about traffic on Maple. I am putting a case together and I want to know what time of day you see it and where exactly.',
    },
    orgs: [
      {
        name: 'Maplewood Public Works',
        why: 'Holds the traffic counter and the corridor. Nothing downstream moves without their number.',
      },
    ],
  },
  {
    id: 'listen_problem',
    stage: 'Understand it',
    short: 'Who to hear from',
    opener: {
      title: "Let's work out who to hear from",
      caption: 'Who this lands on hardest, and how you would reach them.',
    },
    prose:
      'The walk zone is four blocks north of the school. 340 households sit inside it and 312 have a phone. The renters on the north side are thin in your contact file, so the PTA reaches people you do not.',
    questions: [
      {
        ask: 'How do you want to hear from them?',
        options: [
          {
            label: 'Run outreach now',
            note: 'The list of 312 is built and the ask is written. You would be reviewing, not starting.',
          },
          {
            label: 'Record what I have already heard',
            note: 'Counts as real input. Tell me who you heard it from.',
          },
          {
            label: 'Do it, but not yet',
            note: 'I will hold what you wanted and raise it before the method is on the record.',
          },
          {
            label: 'Move on without it',
            note: 'Your call. Nobody in the walk zone will have been asked.',
          },
        ],
      },
    ],
    settled:
      'Outreach is going to the 312 reachable households in the walk zone, asking where it feels unsafe. The renters on the north side stay under-represented, so the PTA is the route to them.',
    outreach: {
      who: 'The 312 reachable walk-zone households',
      count: 312,
      channel: 'Social media',
      message:
        'Where on Maple does it feel unsafe to you: at the crossing, or further down the block?',
    },
    orgs: [
      {
        name: 'Maple Elementary PTA',
        why: 'The only route to the families your contact file misses entirely.',
      },
      {
        name: 'East Side Neighborhood Association',
        why: 'Meets in the evening, when people who work days can actually come.',
      },
    ],
  },
  {
    id: 'options',
    stage: 'Weigh the options',
    short: 'Your options',
    opener: {
      title: "Let's look at how you could do this",
      caption: 'A few real ways to act, and what each one would cost you.',
    },
    prose:
      'Four ways this gets solved somewhere. Staff-directed study and signage: the manager says yes, weeks, cheap, and often not enough. Speed tables: council majority, a few months, real money, and the thing residents actually notice. A safe-routes grant: state DOT says yes, months on their calendar, outside money. A crossing guard: cheapest of all, and Northville tried it and abandoned it after a year when the staffing fell through.',
    questions: [
      {
        ask: 'Which are worth keeping on the table?',
        options: [
          {
            label: 'Speed tables and the grant, together',
            note: 'The grant pays for the tables. Slower, but it does not compete with your capital budget.',
          },
          {
            label: 'Start with the staff study',
            note: 'Fastest thing you control outright, and it produces the evidence the others need.',
          },
          {
            label: 'All four, decide later',
            note: 'Keeps every door open, but you will spend the next month pricing things you will not do.',
          },
        ],
      },
    ],
    settled:
      'You are keeping the staff study and the grant-funded speed tables. The study is the fast move you control and it produces what the grant application needs. The crossing guard is out after what happened in Northville.',
    outreach: {
      who: 'Walk-zone households, on the choice itself',
      count: 312,
      channel: 'Social media',
      message:
        'Two options for Maple: speed tables in the road, or a crossing guard at pickup. Which would you rather we spent on?',
    },
    orgs: [
      {
        name: 'Northville Township Clerk',
        why: 'Ran the crossing-guard program that failed. Worth ten minutes on why before you rule it out publicly.',
      },
    ],
  },
  {
    id: 'listen_options',
    stage: 'Weigh the options',
    short: 'What people back',
    opener: {
      title: "Let's find out which way people lean",
      caption: 'The people whose answer would actually change your mind.',
    },
    prose:
      'The group whose answer would move you is the parents doing the pickup walk, not the whole walk zone. That is about 120 households with a child at the school. The one question worth putting to them: would you rather have the road changed, or a person at the crossing?',
    questions: [
      {
        ask: 'How do you want to put that to them?',
        options: [
          {
            label: 'Ask the PTA to put it to their list',
            note: 'Fastest route to exactly the right people, and it costs you a phone call.',
          },
          {
            label: 'Run it to the 120 households myself',
            note: 'Yours to control and yours to report, but slower and it misses the renters.',
          },
          {
            label: 'Move on, I know what they want',
            note: 'Your call. Worth knowing a colleague can ask who you actually spoke to.',
          },
        ],
      },
    ],
    settled:
      'The PTA is putting one question to the pickup families: change the road, or staff the crossing. You will have an answer before the method goes on the record.',
    outreach: {
      who: 'Pickup families, through the PTA',
      count: 120,
      channel: 'Social media',
      message:
        'Would you rather we changed the road on Maple, or put a person at the crossing at pickup?',
    },
    orgs: [
      {
        name: 'Maple Elementary PTA',
        why: 'Holds the list that is exactly the affected group, which yours is not.',
      },
    ],
  },
  {
    id: 'method',
    stage: 'Decide how',
    short: 'The path',
    opener: {
      title: "Let's pick how you'll make it happen",
      caption: 'What you are allowed to do here, then the path that fits.',
    },
    prose:
      'Authority first, because it is the cheap question that decides the rest. Maple is a city street, but Michigan townships commonly leave the calming standard with the county road commission, and I could not confirm which applies to Maplewood. That is an attorney question, not a search question. Funding: capital plan or safe-routes grant. Who says yes: the manager for a study, a council majority for anything in the road.',
    questions: [
      {
        ask: 'Which path do you want on the record?',
        options: [
          {
            label: 'Staff direction, for the study',
            note: 'My pick. Days to weeks, the manager alone, and it produces what the grant needs.',
          },
          {
            label: 'Grant, for the tables',
            note: 'Outside money and the right fit, but it runs on the state calendar, not yours.',
          },
          {
            label: 'Budget, in the capital plan',
            note: 'Yours to control, but it competes with everything else and the cycle has closed.',
          },
          {
            label: 'Ordinance, a corridor-wide standard',
            note: 'Durable and the biggest lift. Also the one most likely barred if the county owns the standard.',
          },
        ],
      },
    ],
    settled:
      'Staff direction for the study, then a safe-routes grant for the tables. Confirm with the attorney who owns the calming standard before anything goes on an agenda: if it is the county, the grant route changes and the ordinance route closes.',
    outreach: {
      who: 'Walk-zone households, on what is coming',
      count: 312,
      channel: 'Social media',
      message:
        'Public Works is doing a speed study on Maple this month. I will tell you what it finds.',
    },
    orgs: [
      {
        name: 'Maplewood City Attorney',
        why: 'The one office that can settle who owns the calming standard. Everything downstream waits on it.',
      },
    ],
  },
  {
    id: 'plan',
    stage: 'Get it done',
    short: 'The plan',
    opener: {
      title: "Let's turn this into a plan",
      caption: 'The next few things that have to happen, with names and dates.',
    },
    prose:
      'Four actions, in order. Ask the attorney who owns the calming standard on Maple, this week. Ask the manager to direct a speed study at pickup, once the attorney answers. Ask the clerk for the agenda deadline for the second meeting in November, so the study lands before it. Confirm the safe-routes window with the state DOT contact, before the grant closes.',
    questions: [
      {
        ask: 'Which one are you taking first?',
        options: [
          {
            label: 'The attorney',
            note: 'Correct order. Three of the four change depending on the answer.',
          },
          {
            label: 'The manager, for the study',
            note: 'Faster, and you may have to redo it if the county owns the standard.',
          },
          {
            label: 'The clerk, for the deadline',
            note: 'Cheap and worth knowing, but it does not unblock anything yet.',
          },
        ],
      },
    ],
    settled:
      'You are asking the attorney this week who owns the calming standard on Maple. Once that lands, the manager gets the study request, and the agenda deadline and grant window get confirmed around it.',
    outreach: {
      who: 'Everyone who wrote in about Maple',
      count: 48,
      channel: 'Social media',
      message:
        'Update on Maple Ave: a speed study is being set up, and I will bring the results to council with a fix attached.',
    },
    orgs: [
      {
        name: 'Maplewood City Attorney',
        why: 'First call. Nothing else on the plan is safe to start before this answer.',
      },
    ],
  },
]

/** Later check-ins the session shell serves up as you close each one. */
export const LATER_SESSIONS: Session[] = [
  {
    id: 's4',
    date: '2 October',
    age: 'in a few days',
    changed:
      'Fourteen replies from the walk zone. Eleven of them name the crossing rather than the block.',
    didForYou:
      'Read them all and pulled the three that say something you would not have predicted.',
    decision: {
      ask: 'The replies point at the crossing, not the corridor. Does that change what you want to fix?',
      options: [
        {
          label: 'Narrow it to the crossing',
          note: 'Cheaper, faster, and it is what the people who walk it are actually asking for.',
        },
        {
          label: 'Keep the whole corridor',
          note: 'Bigger fix and a bigger ask. Defensible, but it is now further from what they said.',
        },
      ],
    },
  },
  {
    id: 's5',
    date: '9 October',
    age: 'next week',
    changed:
      'The attorney answered. The city owns the standard on Maple, so the county is not in the way.',
    didForYou:
      'Drafted the study request to the manager and found the safe-routes window: applications close 15 January.',
    decision: {
      ask: 'Nothing is blocking you now. Do you want the study request sent?',
      options: [
        {
          label: 'Send it',
          note: 'The manager can direct it without a vote. This is the fastest real movement available.',
        },
        {
          label: 'Hold until the PTA answers',
          note: 'A week or so, and the study scope would reflect what the pickup families said.',
        },
      ],
    },
  },
]

/** What the list shell serves up as each action is completed. */
export const ACTION_QUEUE: Record<string, NextAction[]> = {
  maple: [
    {
      label: 'Ask the manager to direct a speed study at pickup',
      why: 'The attorney confirmed the city owns the standard, so this needs no vote. It is the fastest real movement available and the grant application needs its output.',
      kind: 'do',
    },
    {
      label: 'Confirm the safe-routes window with the state DOT contact',
      why: 'Applications close 15 January. The study has to be finished and attached, so the window decides whether this term or next.',
      kind: 'do',
    },
    {
      label: 'Waiting on the speed study',
      why: 'Public Works has it. Two to three weeks. Nothing useful happens on this priority until the number lands.',
      kind: 'waiting',
    },
  ],
  splash: [
    {
      label: 'Send the update to residents',
      why: 'You approved the draft. It goes to the 1,240 households on the east side who asked about the park.',
      kind: 'do',
    },
    {
      label: 'Waiting on the November capital vote',
      why: 'It cleared committee. The full vote is the second meeting in November and you have the majority counted.',
      kind: 'waiting',
    },
  ],
  canopy: [
    {
      label: 'Nudge the attorney on the canopy target',
      why: 'You asked on 19 September and it has been nine days. A canopy target is unusual enough that it probably needs a second ask.',
      kind: 'do',
    },
    {
      label: 'Find two cities with a binding canopy target',
      why: 'The attorney will want precedent before saying yes. Ann Arbor and Grand Rapids both have one worth reading.',
      kind: 'do',
    },
  ],
}

/** Follow-on exchanges for the two chat shells, in order. */
export type FollowUp = {
  user: string
  agent: string
  /** Dossier sections this exchange fills in, with their new body text. */
  fills?: { id: string; body: string }[]
  card?: { label: string; title: string; lines: string[] }
}

export const FOLLOW_UPS: FollowUp[] = [
  {
    user: 'I asked the attorney. The city owns the standard on Maple.',
    agent:
      'Good, that opens everything back up. The county is not in the way, so the grant route and an ordinance are both available. I have written that down.',
    fills: [
      {
        id: 'authority',
        body: 'The city owns the calming standard on Maple. Confirmed by the city attorney on 28 September, so the county road commission is not a constraint.',
      },
    ],
    card: {
      label: 'Screened the constraints again',
      title: 'Authority settled',
      lines: [
        'City owns the standard on Maple',
        'Funding: capital plan or safe-routes grant',
        'Who says yes: manager for a study, council for the road',
      ],
    },
  },
  {
    user: 'So what are my actual options?',
    agent:
      'Four, and one of them failed somewhere nearby. A staff-directed study is fastest and yours alone. Speed tables need a council majority and real money. A safe-routes grant pays for the tables on the state calendar. A crossing guard is cheapest, and Northville abandoned theirs after a year when staffing fell through.',
    fills: [
      {
        id: 'options',
        body: 'Staff-directed study, speed tables, a safe-routes grant to pay for them, or a crossing guard. Northville dropped the guard after a year on staffing, so it is the weakest of the four here.',
      },
    ],
    card: {
      label: 'Researched comparable cities',
      title: 'Four ways this gets solved',
      lines: [
        'Staff study: the manager, weeks, cheap',
        'Speed tables: council majority, months, real money',
        'Safe-routes grant: state calendar, outside money',
        'Crossing guard: cheapest, and it failed in Northville',
      ],
    },
  },
  {
    user: 'Let us do the study and go after the grant.',
    agent:
      'Recorded. The study is the fast move you control and it produces exactly what the grant application needs. Next real thing is asking the manager to direct it, which needs no vote.',
    fills: [
      {
        id: 'method',
        body: 'Staff direction for the speed study, then a safe-routes grant for the tables. No council vote needed to start.',
      },
      {
        id: 'plan',
        body: 'Ask the manager to direct the study this week. Confirm the safe-routes window, which closes 15 January. Get the November agenda deadline from the clerk.',
      },
    ],
  },
]

/** The quick prompts the capability shell offers, with canned replies. */
export const CAPABILITY_PROMPTS: FollowUp[] = [
  {
    user: 'What should I do about Maple Ave?',
    agent:
      'One cheap question decides the rest: Maple is a city street, but the calming standard may sit with the county. Ask your attorney, and I will price the routes that survive. Everything else on this priority is waiting on that answer.',
  },
  {
    user: 'What is my council hearing about most?',
    agent:
      'Roads, by a distance, and Maple is the corridor inside that. Stormwater on the east side is second and rising since the August rain. Parks is third, and it is mostly the splash pad you already own.',
    card: {
      label: 'Read your community issues',
      title: 'What is coming up most',
      lines: [
        'Roads and traffic: 41 mentions, Maple named in 12',
        'Stormwater: 24 mentions, rising since August',
        'Parks: 18 mentions, mostly Lincoln Park',
      ],
    },
  },
  {
    user: 'Draft an update on the splash pad',
    agent:
      'Written and waiting on your review. It says what cleared committee, when the full vote is, and what happens if it passes. It does not promise a build date, because you do not have one yet.',
    card: {
      label: 'Drafted an update',
      title: 'Lincoln Park splash pad',
      lines: [
        'Cleared committee on Tuesday',
        'Full council vote: second meeting in November',
        'No build date promised',
      ],
    },
  },
]
