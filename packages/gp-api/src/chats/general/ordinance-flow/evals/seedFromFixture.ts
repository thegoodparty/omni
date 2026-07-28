import { PrismaClient } from '../../../../generated/prisma'
import type { OrdinanceFlowStep } from '@goodparty_org/contracts'
import {
  deriveStepEntry,
  loadOrdinanceFixture,
  type OrdinanceFixtureName,
} from './fixtures/stepEntry'

export interface SeededOrdinance {
  organizationSlug: string
  electedOfficeId: string
  ordinanceId: string
  ordinanceSlug: string
}

// The municipality the seeded code record grounds on. Defaults to the captured
// Hendersonville, NC source; override it when a fixture's legal question is
// state-specific (e.g. a Washington preemption case needs a WA jurisdiction so
// the agent searches the right state's law).
export interface SeedJurisdiction {
  place: string
  state: string
  url?: string
}

const DEFAULT_JURISDICTION: SeedJurisdiction = {
  place: 'Hendersonville',
  state: 'NC',
  url: 'https://library.municode.com/nc/hendersonville',
}

// Seed an owned ordinance in the exact state a step begins in: the fixture's
// end-state with that step's outputs (and every later step's) stripped, plus a
// verified code record so the current-law/jurisdiction path has a real
// municipality to ground on. Mirrors the ordinanceFlow integration seed but
// hydrates the prior-step artifacts the real turn will read.
export const seedFromFixture = async (
  prisma: PrismaClient,
  userId: number,
  fixture: OrdinanceFixtureName,
  step: OrdinanceFlowStep,
  jurisdiction: SeedJurisdiction = DEFAULT_JURISDICTION,
): Promise<SeededOrdinance> => {
  const entry = deriveStepEntry(loadOrdinanceFixture(fixture), step)
  const suffix = Math.random().toString(36).slice(2, 10)
  const organizationSlug = `eval-eo-${userId}-${suffix}`

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
  await prisma.ordinanceCodeRecord.create({
    data: {
      organizationSlug,
      codeFound: true,
      dataQuality: 'OK',
      confidence: 'HIGH',
      hostType: 'MUNICODE',
      url:
        jurisdiction.url ??
        `https://library.municode.com/${jurisdiction.state.toLowerCase()}/${jurisdiction.place.toLowerCase().replace(/\s+/g, '_')}`,
      place: jurisdiction.place,
      state: jurisdiction.state,
      verifiedEvidence: `Eval fixture: ${jurisdiction.place}, ${jurisdiction.state} on Municode.`,
      artifactBucket: 'gp-agent-artifacts-test',
      artifactKey: 'find_existing_ordinances/eval/output.json',
      verifiedAt: new Date(),
    },
  })
  const ordinance = await prisma.ordinance.create({
    data: {
      electedOfficeId: electedOffice.id,
      seedType: entry.seedType,
      issueSlug: entry.issueSlug,
      goalText: entry.goalText,
      clarifyAnswers: entry.clarifyAnswers ?? undefined,
      authority: entry.authority ?? undefined,
      comparables: entry.comparables ?? undefined,
      existingLaw: entry.existingLaw ?? undefined,
      draftTitle: entry.draftTitle,
      draftBody: entry.draftBody,
      draftSources: entry.draftSources ?? undefined,
      qualityReport: entry.qualityReport ?? undefined,
    },
  })

  return {
    organizationSlug,
    electedOfficeId: electedOffice.id,
    ordinanceId: ordinance.id,
    ordinanceSlug: ordinance.slug,
  }
}
