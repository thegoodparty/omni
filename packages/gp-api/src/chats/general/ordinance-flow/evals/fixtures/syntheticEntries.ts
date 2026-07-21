import { PrismaClient } from '../../../../../generated/prisma'
import type {
  OrdinanceFlowStep,
  OrdinanceSeedType,
} from '@goodparty_org/contracts'
import type { SeededOrdinance } from '../seedFromFixture'

// Goal-only synthetic entry states — no captured artifacts, unlike records/.
// Each pins a distinct ordinance topic (for coverage beyond the handful of
// captured sessions) plus the data-state axis via hasCodeRecord: whether a
// verified OrdinanceCodeRecord exists for the org. With one, the current-law
// and authority steps ground in the verified municipality; without one,
// jurisdiction resolves to null and the agent must ask for or flag the missing
// jurisdiction rather than invent it (#874).
export interface SyntheticOrdinanceEntry {
  name: string
  goalText: string
  seedType: OrdinanceSeedType
  hasCodeRecord: boolean
  // The intended jurisdiction. Seeded onto the code record only when
  // hasCodeRecord; otherwise metadata that the agent should NOT be able to
  // recover (context jurisdiction stays null).
  place: string
  state: string
  codeUrl: string
}

export const SYNTHETIC_ORDINANCE_ENTRIES: SyntheticOrdinanceEntry[] = [
  {
    name: 'late-night-noise',
    goalText:
      'Limit late-night construction and amplified noise in residential ' +
      'neighborhoods',
    seedType: 'new',
    hasCodeRecord: true,
    place: 'Hendersonville',
    state: 'NC',
    codeUrl: 'https://library.municode.com/nc/hendersonville',
  },
  {
    name: 'food-truck-permitting',
    goalText:
      'Create a permitting process for mobile food vendors operating on ' +
      'public streets',
    seedType: 'new',
    hasCodeRecord: true,
    place: 'Asheville',
    state: 'NC',
    codeUrl: 'https://library.municode.com/nc/asheville',
  },
  {
    name: 'sidewalk-repair-cost-share',
    goalText:
      'Establish a cost-sharing program between the city and property owners ' +
      'for sidewalk repair',
    seedType: 'new',
    hasCodeRecord: true,
    place: 'Raleigh',
    state: 'NC',
    codeUrl: 'https://library.municode.com/nc/raleigh',
  },
  {
    name: 'tree-canopy',
    goalText:
      'Protect the urban tree canopy by requiring a permit to remove mature ' +
      'trees on private lots',
    seedType: 'new',
    hasCodeRecord: true,
    place: 'Durham',
    state: 'NC',
    codeUrl: 'https://library.municode.com/nc/durham',
  },
]

export const syntheticEntryByName = (name: string): SyntheticOrdinanceEntry => {
  const entry = SYNTHETIC_ORDINANCE_ENTRIES.find((e) => e.name === name)
  if (!entry) {
    throw new Error(`Unknown synthetic ordinance entry: ${name}`)
  }
  return entry
}

// Seed a goal-only ordinance in the state a step begins in, mirroring
// seedFromFixture's org/office/ordinance shape but WITHOUT any prior-step
// artifacts. The ordinanceCodeRecord is created only when entry.hasCodeRecord —
// that toggle is the data-state axis the jurisdiction-fallback eval exercises.
export const seedSyntheticEntry = async (
  prisma: PrismaClient,
  userId: number,
  entry: SyntheticOrdinanceEntry,
  step: OrdinanceFlowStep,
): Promise<SeededOrdinance> => {
  const suffix = Math.random().toString(36).slice(2, 10)
  const organizationSlug = `eval-syn-${userId}-${suffix}`

  await prisma.organization.create({
    data: {
      slug: organizationSlug,
      ownerId: userId,
      customPositionName: 'Council Member',
    },
  })
  const electedOffice = await prisma.electedOffice.create({
    data: { organizationSlug, userId },
  })
  if (entry.hasCodeRecord) {
    await prisma.ordinanceCodeRecord.create({
      data: {
        organizationSlug,
        codeFound: true,
        dataQuality: 'OK',
        confidence: 'HIGH',
        hostType: 'MUNICODE',
        url: entry.codeUrl,
        place: entry.place,
        state: entry.state,
        verifiedEvidence: `Eval synthetic code source for ${entry.name}.`,
        artifactBucket: 'gp-agent-artifacts-test',
        artifactKey: 'find_existing_ordinances/eval/output.json',
        verifiedAt: new Date(),
      },
    })
  }
  const ordinance = await prisma.ordinance.create({
    data: {
      electedOfficeId: electedOffice.id,
      seedType: entry.seedType,
      goalText: entry.goalText,
      lastViewedStep: step,
    },
  })

  return {
    organizationSlug,
    electedOfficeId: electedOffice.id,
    ordinanceId: ordinance.id,
    ordinanceSlug: ordinance.slug,
  }
}
