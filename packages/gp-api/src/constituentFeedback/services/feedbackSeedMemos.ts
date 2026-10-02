import { ConstituentFeedbackStance } from '@/generated/prisma'

export type SeedMemo = {
  transcript: string
  issueLabel: string
  stance: ConstituentFeedbackStance
  desiredOutcome: string | null
}

const FLOODING = 'Street flooding'
const SPEEDING = 'Speeding near the school'
const TAXES = 'Property taxes'
const COMPOST = 'Composting pilot'
const PARKS = 'Park maintenance'

const { supports, opposes, mixed, unclear } = ConstituentFeedbackStance

// Forty notes in a canvasser's voice across five issues, interleaved so any
// prefix of the list touches all five. Stances vary within each issue, and
// most notes record no ask, as real ones do.
export const SEED_MEMOS: SeedMemo[] = [
  {
    transcript:
      'Maria says the storm drain on her corner backs up every time it rains and the water gets into her garage.',
    issueLabel: FLOODING,
    stance: opposes,
    desiredOutcome: 'Clear and enlarge the storm drain on her corner',
  },
  {
    transcript:
      'He walks his kids to Lincoln Elementary and says cars fly down Oak Street at pickup time.',
    issueLabel: SPEEDING,
    stance: opposes,
    desiredOutcome: 'Speed bumps on Oak Street',
  },
  {
    transcript:
      'Retired couple, fixed income. Their property tax bill went up again and they are worried about staying in the house.',
    issueLabel: TAXES,
    stance: opposes,
    desiredOutcome: 'A tax freeze for seniors',
  },
  {
    transcript:
      'She signed up for the compost pilot and loves it, wants it expanded to the whole city.',
    issueLabel: COMPOST,
    stance: supports,
    desiredOutcome: 'Expand the compost pilot citywide',
  },
  {
    transcript:
      'He coaches youth soccer and says the fields at Riverside Park are full of holes.',
    issueLabel: PARKS,
    stance: opposes,
    desiredOutcome: 'Regrade the soccer fields at Riverside Park',
  },
  {
    transcript:
      'Talked about flooding on Elm. She has not had water in the basement herself but her neighbors have.',
    issueLabel: FLOODING,
    stance: unclear,
    desiredOutcome: null,
  },
  {
    transcript:
      'Crossing guard at the school only works mornings, so afternoons are the dangerous part according to him.',
    issueLabel: SPEEDING,
    stance: opposes,
    desiredOutcome: 'An afternoon crossing guard',
  },
  {
    transcript:
      'She thinks the tax increase is fine if it actually goes to the schools, but does not trust that it will.',
    issueLabel: TAXES,
    stance: mixed,
    desiredOutcome: 'Show where the tax money goes',
  },
  {
    transcript:
      'He thinks the compost bins attract raccoons and wants the pilot ended on his block.',
    issueLabel: COMPOST,
    stance: opposes,
    desiredOutcome: 'End the compost pilot on his block',
  },
  {
    transcript:
      'Mentioned the bathrooms at the park have been locked all summer.',
    issueLabel: PARKS,
    stance: opposes,
    desiredOutcome: 'Reopen the park bathrooms',
  },
  {
    transcript:
      'His street floods at the low spot by the creek. Says it has been reported for years and nothing happens.',
    issueLabel: FLOODING,
    stance: opposes,
    desiredOutcome: null,
  },
  {
    transcript:
      'She supports speed cameras near the school even though she got a ticket from one last year.',
    issueLabel: SPEEDING,
    stance: supports,
    desiredOutcome: 'Keep the speed cameras by the school',
  },
  {
    transcript:
      'Landlord. Says the property tax goes straight into his tenants rent and nobody at city hall understands that.',
    issueLabel: TAXES,
    stance: opposes,
    desiredOutcome: null,
  },
  {
    transcript:
      'Likes the idea of composting but the pickup day keeps changing and she misses it.',
    issueLabel: COMPOST,
    stance: mixed,
    desiredOutcome: 'A fixed compost pickup day',
  },
  {
    transcript:
      'Says the new playground equipment is great, the problem is the trash cans are never emptied.',
    issueLabel: PARKS,
    stance: mixed,
    desiredOutcome: 'Empty the park trash cans more often',
  },
  {
    transcript:
      'Asked whether the city has a plan for the flooding. Did not say whether it affects him.',
    issueLabel: FLOODING,
    stance: unclear,
    desiredOutcome: null,
  },
  {
    transcript:
      'Thinks the speeding complaints are overblown and does not want more speed bumps on his commute.',
    issueLabel: SPEEDING,
    stance: supports,
    desiredOutcome: 'No new speed bumps',
  },
  {
    transcript:
      'Young family, first house. They support the school levy even with the higher taxes.',
    issueLabel: TAXES,
    stance: supports,
    desiredOutcome: null,
  },
  {
    transcript:
      'Asked about the compost pilot. She had not heard of it but wants to know how to sign up.',
    issueLabel: COMPOST,
    stance: unclear,
    desiredOutcome: 'Information on joining the compost pilot',
  },
  {
    transcript:
      'Walks her dog at Maple Park every day and says the lights on the path have been out for months.',
    issueLabel: PARKS,
    stance: opposes,
    desiredOutcome: 'Fix the path lights at Maple Park',
  },
  {
    transcript:
      'Their basement flooded twice this spring. Wants the city to help pay for a backflow valve.',
    issueLabel: FLOODING,
    stance: opposes,
    desiredOutcome: 'Rebates for backflow valves',
  },
  {
    transcript:
      'Lives across from the middle school. Says parents double park and block the street every morning.',
    issueLabel: SPEEDING,
    stance: opposes,
    desiredOutcome: 'Enforce no parking in the school zone',
  },
  {
    transcript:
      'He wants to know why the assessment on his house jumped when nothing changed.',
    issueLabel: TAXES,
    stance: unclear,
    desiredOutcome: 'Explain the new assessments',
  },
  {
    transcript:
      'Big supporter of the compost pilot. Says it cut her trash in half.',
    issueLabel: COMPOST,
    stance: supports,
    desiredOutcome: null,
  },
  {
    transcript:
      'Thinks the parks are in fine shape and the money should go to roads instead.',
    issueLabel: PARKS,
    stance: supports,
    desiredOutcome: null,
  },
  {
    transcript:
      'Said the drainage project last year helped on her street but the next block still floods.',
    issueLabel: FLOODING,
    stance: mixed,
    desiredOutcome: 'Extend the drainage project one more block',
  },
  {
    transcript:
      'Grandmother who picks up from Washington Elementary. Wants a flashing school zone sign.',
    issueLabel: SPEEDING,
    stance: opposes,
    desiredOutcome: 'A flashing school zone sign',
  },
  {
    transcript:
      'He is fine with taxes as they are and does not want any new spending.',
    issueLabel: TAXES,
    stance: mixed,
    desiredOutcome: null,
  },
  {
    transcript: 'Says the compost bins are too big for apartment kitchens.',
    issueLabel: COMPOST,
    stance: mixed,
    desiredOutcome: 'A smaller kitchen bin',
  },
  {
    transcript:
      'The splash pad at Riverside has been broken since June and the kids on the block have nowhere to go.',
    issueLabel: PARKS,
    stance: opposes,
    desiredOutcome: 'Repair the splash pad at Riverside Park',
  },
  {
    transcript: 'Short conversation. He mentioned flooding but had to go.',
    issueLabel: FLOODING,
    stance: unclear,
    desiredOutcome: null,
  },
  {
    transcript:
      'She wants the speed limit by the school lowered to 15 all day, not just during school hours.',
    issueLabel: SPEEDING,
    stance: opposes,
    desiredOutcome: 'A 15 mph school zone all day',
  },
  {
    transcript:
      'Owns a small shop. Says commercial property taxes are pushing businesses out of downtown.',
    issueLabel: TAXES,
    stance: opposes,
    desiredOutcome: 'Lower commercial property taxes downtown',
  },
  {
    transcript:
      'He likes the compost pilot and wants the finished compost given back to residents for gardens.',
    issueLabel: COMPOST,
    stance: supports,
    desiredOutcome: 'Give finished compost back to residents',
  },
  {
    transcript:
      'Asked about the park. Said she does not go much and has no opinion.',
    issueLabel: PARKS,
    stance: unclear,
    desiredOutcome: null,
  },
  {
    transcript:
      'Insurance dropped them after the last flood. They want the city to update the flood maps.',
    issueLabel: FLOODING,
    stance: opposes,
    desiredOutcome: 'Update the city flood maps',
  },
  {
    transcript:
      'Says the speed bumps on Pine worked and wants the same on Oak.',
    issueLabel: SPEEDING,
    stance: supports,
    desiredOutcome: 'Speed bumps on Oak like the ones on Pine',
  },
  {
    transcript:
      'Asked how much of the tax bill goes to the city versus the county. Was not upset, just curious.',
    issueLabel: TAXES,
    stance: unclear,
    desiredOutcome: null,
  },
  {
    transcript:
      'Thinks the compost pilot is a waste of money while the roads are falling apart.',
    issueLabel: COMPOST,
    stance: opposes,
    desiredOutcome: null,
  },
  {
    transcript:
      'Volunteers with the park cleanup group and wants the city to supply gloves and bags.',
    issueLabel: PARKS,
    stance: supports,
    desiredOutcome: 'Supplies for the park cleanup volunteers',
  },
]
