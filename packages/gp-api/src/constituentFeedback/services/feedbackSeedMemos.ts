import { ConstituentFeedbackStance } from '@/generated/prisma'

export type SeedIssue = {
  issueLabel: string
  stance: ConstituentFeedbackStance
  desiredOutcome: string | null
}

export type SeedMemo = {
  transcript: string
  issues: SeedIssue[]
}

const FLOODING = 'Street flooding'
const SPEEDING = 'Speeding near the school'
const TAXES = 'Property taxes'
const COMPOST = 'Composting pilot'
const PARKS = 'Park maintenance'

const { supports, opposes, mixed, unclear } = ConstituentFeedbackStance

// Forty notes in a canvasser's voice across five issues, interleaved so any
// prefix of the list touches all five. Stances vary within each issue, most
// notes record no ask, as real ones do, and about one in four raises a
// second or third issue, so the report sees conversations that named several.
export const SEED_MEMOS: SeedMemo[] = [
  {
    transcript:
      'Maria says the storm drain on her corner backs up every time it rains and the water gets into her garage.',
    issues: [
      {
        issueLabel: FLOODING,
        stance: opposes,
        desiredOutcome: 'Clear and enlarge the storm drain on her corner',
      },
    ],
  },
  {
    transcript:
      'He walks his kids to Lincoln Elementary and says cars fly down Oak Street at pickup time.',
    issues: [
      {
        issueLabel: SPEEDING,
        stance: opposes,
        desiredOutcome: 'Speed bumps on Oak Street',
      },
    ],
  },
  {
    transcript:
      'Retired couple, fixed income. Their property tax bill went up again and they are worried about staying in the house. They also want the storm drain on their street cleared before winter.',
    issues: [
      {
        issueLabel: TAXES,
        stance: opposes,
        desiredOutcome: 'A tax freeze for seniors',
      },
      {
        issueLabel: FLOODING,
        stance: opposes,
        desiredOutcome: 'Clear the storm drain before winter',
      },
    ],
  },
  {
    transcript:
      'She signed up for the compost pilot and loves it, wants it expanded to the whole city.',
    issues: [
      {
        issueLabel: COMPOST,
        stance: supports,
        desiredOutcome: 'Expand the compost pilot citywide',
      },
    ],
  },
  {
    transcript:
      'He coaches youth soccer and says the fields at Riverside Park are full of holes.',
    issues: [
      {
        issueLabel: PARKS,
        stance: opposes,
        desiredOutcome: 'Regrade the soccer fields at Riverside Park',
      },
    ],
  },
  {
    transcript:
      'Talked about flooding on Elm. She has not had water in the basement herself but her neighbors have. She also says cars speed past the school on her way to work.',
    issues: [
      { issueLabel: FLOODING, stance: unclear, desiredOutcome: null },
      { issueLabel: SPEEDING, stance: opposes, desiredOutcome: null },
    ],
  },
  {
    transcript:
      'Crossing guard at the school only works mornings, so afternoons are the dangerous part according to him.',
    issues: [
      {
        issueLabel: SPEEDING,
        stance: opposes,
        desiredOutcome: 'An afternoon crossing guard',
      },
    ],
  },
  {
    transcript:
      'She thinks the tax increase is fine if it actually goes to the schools, but does not trust that it will.',
    issues: [
      {
        issueLabel: TAXES,
        stance: mixed,
        desiredOutcome: 'Show where the tax money goes',
      },
    ],
  },
  {
    transcript:
      'He thinks the compost bins attract raccoons and wants the pilot ended on his block.',
    issues: [
      {
        issueLabel: COMPOST,
        stance: opposes,
        desiredOutcome: 'End the compost pilot on his block',
      },
    ],
  },
  {
    transcript:
      'Mentioned the bathrooms at the park have been locked all summer. Also likes the compost pilot, and says their taxes are too high.',
    issues: [
      {
        issueLabel: PARKS,
        stance: opposes,
        desiredOutcome: 'Reopen the park bathrooms',
      },
      { issueLabel: COMPOST, stance: supports, desiredOutcome: null },
      { issueLabel: TAXES, stance: opposes, desiredOutcome: null },
    ],
  },
  {
    transcript:
      'His street floods at the low spot by the creek. Says it has been reported for years and nothing happens.',
    issues: [{ issueLabel: FLOODING, stance: opposes, desiredOutcome: null }],
  },
  {
    transcript:
      'She supports speed cameras near the school even though she got a ticket from one last year.',
    issues: [
      {
        issueLabel: SPEEDING,
        stance: supports,
        desiredOutcome: 'Keep the speed cameras by the school',
      },
    ],
  },
  {
    transcript:
      'Landlord. Says the property tax goes straight into his tenants rent and nobody at city hall understands that.',
    issues: [{ issueLabel: TAXES, stance: opposes, desiredOutcome: null }],
  },
  {
    transcript:
      'Likes the idea of composting but the pickup day keeps changing and she misses it. She also wants to know why her tax bill went up.',
    issues: [
      {
        issueLabel: COMPOST,
        stance: mixed,
        desiredOutcome: 'A fixed compost pickup day',
      },
      {
        issueLabel: TAXES,
        stance: unclear,
        desiredOutcome: 'Explain the tax increase',
      },
    ],
  },
  {
    transcript:
      'Says the new playground equipment is great, the problem is the trash cans are never emptied.',
    issues: [
      {
        issueLabel: PARKS,
        stance: mixed,
        desiredOutcome: 'Empty the park trash cans more often',
      },
    ],
  },
  {
    transcript:
      'Asked whether the city has a plan for the flooding. Did not say whether it affects him.',
    issues: [{ issueLabel: FLOODING, stance: unclear, desiredOutcome: null }],
  },
  {
    transcript:
      'Thinks the speeding complaints are overblown and does not want more speed bumps on his commute.',
    issues: [
      {
        issueLabel: SPEEDING,
        stance: supports,
        desiredOutcome: 'No new speed bumps',
      },
    ],
  },
  {
    transcript:
      'Young family, first house. They support the school levy even with the higher taxes. They also worry about the flooding on their block.',
    issues: [
      { issueLabel: TAXES, stance: supports, desiredOutcome: null },
      { issueLabel: FLOODING, stance: opposes, desiredOutcome: null },
    ],
  },
  {
    transcript:
      'Asked about the compost pilot. She had not heard of it but wants to know how to sign up.',
    issues: [
      {
        issueLabel: COMPOST,
        stance: unclear,
        desiredOutcome: 'Information on joining the compost pilot',
      },
    ],
  },
  {
    transcript:
      'Walks her dog at Maple Park every day and says the lights on the path have been out for months.',
    issues: [
      {
        issueLabel: PARKS,
        stance: opposes,
        desiredOutcome: 'Fix the path lights at Maple Park',
      },
    ],
  },
  {
    transcript:
      'Their basement flooded twice this spring. Wants the city to help pay for a backflow valve. Also wants the speed limit enforced on their street.',
    issues: [
      {
        issueLabel: FLOODING,
        stance: opposes,
        desiredOutcome: 'Rebates for backflow valves',
      },
      {
        issueLabel: SPEEDING,
        stance: opposes,
        desiredOutcome: 'Enforce the speed limit on their street',
      },
    ],
  },
  {
    transcript:
      'Lives across from the middle school. Says parents double park and block the street every morning.',
    issues: [
      {
        issueLabel: SPEEDING,
        stance: opposes,
        desiredOutcome: 'Enforce no parking in the school zone',
      },
    ],
  },
  {
    transcript:
      'He wants to know why the assessment on his house jumped when nothing changed.',
    issues: [
      {
        issueLabel: TAXES,
        stance: unclear,
        desiredOutcome: 'Explain the new assessments',
      },
    ],
  },
  {
    transcript:
      'Big supporter of the compost pilot. Says it cut her trash in half.',
    issues: [{ issueLabel: COMPOST, stance: supports, desiredOutcome: null }],
  },
  {
    transcript:
      'Thinks the parks are in fine shape and the money should go to roads instead. Also wants cars slowed down by the school, and says property taxes are too high.',
    issues: [
      { issueLabel: PARKS, stance: supports, desiredOutcome: null },
      {
        issueLabel: SPEEDING,
        stance: opposes,
        desiredOutcome: 'Slow the cars down by the school',
      },
      { issueLabel: TAXES, stance: opposes, desiredOutcome: null },
    ],
  },
  {
    transcript:
      'Said the drainage project last year helped on her street but the next block still floods.',
    issues: [
      {
        issueLabel: FLOODING,
        stance: mixed,
        desiredOutcome: 'Extend the drainage project one more block',
      },
    ],
  },
  {
    transcript:
      'Grandmother who picks up from Washington Elementary. Wants a flashing school zone sign.',
    issues: [
      {
        issueLabel: SPEEDING,
        stance: opposes,
        desiredOutcome: 'A flashing school zone sign',
      },
    ],
  },
  {
    transcript:
      'He is fine with taxes as they are and does not want any new spending.',
    issues: [{ issueLabel: TAXES, stance: mixed, desiredOutcome: null }],
  },
  {
    transcript:
      'Says the compost bins are too big for apartment kitchens. Also says the parks look better this year.',
    issues: [
      {
        issueLabel: COMPOST,
        stance: mixed,
        desiredOutcome: 'A smaller kitchen bin',
      },
      { issueLabel: PARKS, stance: supports, desiredOutcome: null },
    ],
  },
  {
    transcript:
      'The splash pad at Riverside has been broken since June and the kids on the block have nowhere to go.',
    issues: [
      {
        issueLabel: PARKS,
        stance: opposes,
        desiredOutcome: 'Repair the splash pad at Riverside Park',
      },
    ],
  },
  {
    transcript: 'Short conversation. He mentioned flooding but had to go.',
    issues: [{ issueLabel: FLOODING, stance: unclear, desiredOutcome: null }],
  },
  {
    transcript:
      'She wants the speed limit by the school lowered to 15 all day, not just during school hours. She also mentioned water pooling at the bus stop when it rains.',
    issues: [
      {
        issueLabel: SPEEDING,
        stance: opposes,
        desiredOutcome: 'A 15 mph school zone all day',
      },
      {
        issueLabel: FLOODING,
        stance: opposes,
        desiredOutcome: 'Fix the drainage at the bus stop',
      },
    ],
  },
  {
    transcript:
      'Owns a small shop. Says commercial property taxes are pushing businesses out of downtown.',
    issues: [
      {
        issueLabel: TAXES,
        stance: opposes,
        desiredOutcome: 'Lower commercial property taxes downtown',
      },
    ],
  },
  {
    transcript:
      'He likes the compost pilot and wants the finished compost given back to residents for gardens.',
    issues: [
      {
        issueLabel: COMPOST,
        stance: supports,
        desiredOutcome: 'Give finished compost back to residents',
      },
    ],
  },
  {
    transcript:
      'Asked about the park. Said she does not go much and has no opinion.',
    issues: [{ issueLabel: PARKS, stance: unclear, desiredOutcome: null }],
  },
  {
    transcript:
      'Insurance dropped them after the last flood. They want the city to update the flood maps. They also want the soccer fields at Riverside fixed.',
    issues: [
      {
        issueLabel: FLOODING,
        stance: opposes,
        desiredOutcome: 'Update the city flood maps',
      },
      {
        issueLabel: PARKS,
        stance: opposes,
        desiredOutcome: 'Regrade the soccer fields at Riverside Park',
      },
    ],
  },
  {
    transcript:
      'Says the speed bumps on Pine worked and wants the same on Oak.',
    issues: [
      {
        issueLabel: SPEEDING,
        stance: supports,
        desiredOutcome: 'Speed bumps on Oak like the ones on Pine',
      },
    ],
  },
  {
    transcript:
      'Asked how much of the tax bill goes to the city versus the county. Was not upset, just curious.',
    issues: [{ issueLabel: TAXES, stance: unclear, desiredOutcome: null }],
  },
  {
    transcript:
      'Thinks the compost pilot is a waste of money while the roads are falling apart. Also wants a crosswalk by the school, and the flooding on Elm fixed.',
    issues: [
      { issueLabel: COMPOST, stance: opposes, desiredOutcome: null },
      {
        issueLabel: SPEEDING,
        stance: opposes,
        desiredOutcome: 'A crosswalk by the school',
      },
      { issueLabel: FLOODING, stance: opposes, desiredOutcome: null },
    ],
  },
  {
    transcript:
      'Volunteers with the park cleanup group and wants the city to supply gloves and bags.',
    issues: [
      {
        issueLabel: PARKS,
        stance: supports,
        desiredOutcome: 'Supplies for the park cleanup volunteers',
      },
    ],
  },
]
