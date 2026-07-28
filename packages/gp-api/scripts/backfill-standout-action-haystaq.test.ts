import { describe, expect, it } from 'vitest'
import { useTestService } from '../src/test-service'
import {
  backfill,
  matchIssue,
  pctVariants,
  type IssueEntry,
  type IssueMap,
  type StandoutRow,
} from './backfill-standout-action-haystaq'

const issue = (overrides: Partial<IssueEntry> = {}): IssueEntry => ({
  hs_column: 'hs_tax_cuts_support',
  phrase: 'supporting tax cuts',
  cited_pct: 44.5,
  dir: 'low',
  ...overrides,
})

const row = (overrides: Partial<StandoutRow> = {}): StandoutRow => ({
  id: 1,
  body: 'Placeholder body.',
  smsMessage: 'Placeholder sms.',
  hsColumn: null,
  ...overrides,
})

describe('pctVariants', () => {
  it('emits the one-decimal and bare-string forms for a fractional pct', () => {
    expect(pctVariants(44.5)).toEqual(['44.5%'])
  })

  it('adds the integer form for an integral pct', () => {
    expect(pctVariants(74).sort()).toEqual(['74%', '74.0%'])
  })
})

describe('matchIssue', () => {
  it('stamps the single row whose body cites the one-decimal variant', () => {
    const target = row({
      id: 7,
      body: 'Only 44.5% of the district backs tax cuts. You do not.',
    })
    const result = matchIssue([target, row({ id: 8 })], issue())
    expect(result).toEqual({ status: 'stamp', row: target })
  })

  it('matches an integral pct written without a decimal', () => {
    const target = row({ id: 9, body: '74% of voters lean this way.' })
    const result = matchIssue([target], issue({ cited_pct: 74 }))
    expect(result).toEqual({ status: 'stamp', row: target })
  })

  it('falls back to smsMessage only when no body matches', () => {
    const target = row({
      id: 10,
      body: 'No number here.',
      smsMessage: 'I know 44.5% of us want lower taxes.',
    })
    const result = matchIssue([target, row({ id: 11 })], issue())
    expect(result).toEqual({ status: 'stamp', row: target })
  })

  it('prefers a body match over an smsMessage match', () => {
    const bodyHit = row({ id: 12, body: 'Body cites 44.5% support.' })
    const smsHit = row({
      id: 13,
      body: 'No number.',
      smsMessage: 'sms cites 44.5%.',
    })
    const result = matchIssue([bodyHit, smsHit], issue())
    expect(result).toEqual({ status: 'stamp', row: bodyHit })
  })

  it('reports ambiguous when two rows cite the same pct', () => {
    const result = matchIssue(
      [
        row({ id: 1, body: 'Card one: 44.5% here.' }),
        row({ id: 2, body: 'Card two: also 44.5%.' }),
      ],
      issue(),
    )
    expect(result).toEqual({ status: 'ambiguous' })
  })

  it('reports no_match when no row cites the pct', () => {
    const result = matchIssue([row({ body: 'nothing numeric' })], issue())
    expect(result).toEqual({ status: 'no_match' })
  })

  it('reports already when the single matching row is already stamped', () => {
    const already = row({
      id: 3,
      body: '44.5% of the district.',
      hsColumn: 'hs_tax_cuts_support',
    })
    const result = matchIssue([already], issue())
    expect(result).toEqual({ status: 'already' })
  })
})

describe('backfill against the database', () => {
  const service = useTestService()

  const seedCampaign = async (slug: string) => {
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    return service.prisma.campaign.create({
      data: {
        organizationSlug: slug,
        userId: service.user.id,
        slug,
        isPro: true,
      },
    })
  }

  const seedCard = (
    campaignId: number,
    order: number,
    overrides: Record<string, unknown> = {},
  ) =>
    service.prisma.raceOpponentStandoutAction.create({
      data: {
        campaignId,
        order,
        title: `Card ${order}`,
        body: 'Placeholder body.',
        smsMessage: 'Placeholder sms.',
        issue: 'infrastructure',
        ...overrides,
      },
    })

  const mapFor = (slug: string, issues: IssueEntry[]): IssueMap => ({
    [slug]: { issues },
  })

  const taxIssue: IssueEntry = {
    hs_column: 'hs_tax_cuts_support',
    phrase: 'supporting tax cuts',
    cited_pct: 44.5,
    dir: 'low',
  }

  it('stamps the matched card, leaves stat columns null, and is idempotent', async () => {
    const campaign = await seedCampaign('bf-basic')
    const card = await seedCard(campaign.id, 0, {
      body: 'Only 44.5% of the district backs tax cuts. You do not.',
    })
    await seedCard(campaign.id, 1, { body: 'A card with no number.' })
    const map = mapFor('bf-basic', [taxIssue])

    const first = await backfill(service.prisma, map, true)
    expect(first[0]).toMatchObject({
      found: true,
      stamped: 1,
      already: 0,
      unresolved: [],
    })

    const stamped = await service.prisma.raceOpponentStandoutAction.findUnique({
      where: { id: card.id },
    })
    expect(stamped).toMatchObject({
      hsColumn: 'hs_tax_cuts_support',
      positionPhrase: 'supporting tax cuts',
      positionDir: 'low',
      haystaqTotalActive: null,
      haystaqCountGe50: null,
      haystaqPctGe50: null,
      haystaqCountGe70: null,
      haystaqPctGe70: null,
    })

    const second = await backfill(service.prisma, map, true)
    expect(second[0]).toMatchObject({ stamped: 0, already: 1 })
  })

  it('dry run classifies a match without writing', async () => {
    const campaign = await seedCampaign('bf-dry')
    const card = await seedCard(campaign.id, 0, { body: 'Just 44.5% agree.' })

    const reports = await backfill(
      service.prisma,
      mapFor('bf-dry', [taxIssue]),
      false,
    )

    expect(reports[0]).toMatchObject({ stamped: 1 })
    const row = await service.prisma.raceOpponentStandoutAction.findUnique({
      where: { id: card.id },
    })
    expect(row?.hsColumn).toBeNull()
  })

  it('leaves both rows unstamped and unresolved when a pct is ambiguous', async () => {
    const campaign = await seedCampaign('bf-ambiguous')
    const a = await seedCard(campaign.id, 0, { body: 'Card A: 44.5% here.' })
    const b = await seedCard(campaign.id, 1, { body: 'Card B: also 44.5%.' })

    const reports = await backfill(
      service.prisma,
      mapFor('bf-ambiguous', [taxIssue]),
      true,
    )

    expect(reports[0]).toMatchObject({
      stamped: 0,
      unresolved: [
        {
          hsColumn: 'hs_tax_cuts_support',
          citedPct: 44.5,
          reason: 'ambiguous',
        },
      ],
    })
    for (const id of [a.id, b.id]) {
      const row = await service.prisma.raceOpponentStandoutAction.findUnique({
        where: { id },
      })
      expect(row?.hsColumn).toBeNull()
    }
  })

  it('reports a slug whose campaign is not in the database', async () => {
    const reports = await backfill(
      service.prisma,
      mapFor('bf-missing-campaign', [taxIssue]),
      true,
    )
    expect(reports[0]).toMatchObject({ found: false, stamped: 0 })
  })
})
