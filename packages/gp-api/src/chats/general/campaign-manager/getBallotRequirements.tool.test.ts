import { describe, expect, it, vi } from 'vitest'
import {
  buildGetBallotRequirementsTool,
  type GetBallotRequirementsOutput,
} from './getBallotRequirements.tool'
import type { ElectionsService } from '@/elections/services/elections.service'

const build = (
  result: Awaited<ReturnType<ElectionsService['fetchFilingFeeByRaceHash']>>,
) => {
  const fetchFilingFeeByRaceHash = vi.fn(() => Promise.resolve(result))
  const tool = buildGetBallotRequirementsTool({
    elections: { fetchFilingFeeByRaceHash },
    raceId: 'br-hash-1',
  })
  // execute() is typed Promise<unknown> so the tool stays assignable to the
  // erased registry; cast once here rather than at every call site.
  const run = async (): Promise<GetBallotRequirementsOutput> =>
    (await tool.execute({})) as GetBallotRequirementsOutput
  return { tool, run, fetchFilingFeeByRaceHash }
}

const FULL = {
  filingFee: 100,
  filingRequirementsText: '$100 filing fee and 25 signatures',
  extractionSource: 'direct_dollar',
  filingOfficeAddress: '1 Main St, Springfield, IL 62701',
  filingPhoneNumber: '555-0100',
  paperworkInstructions: 'File with the county clerk.',
}

describe('buildGetBallotRequirementsTool', () => {
  it('returns the race filing details and binds the race server-side', async () => {
    const { run, fetchFilingFeeByRaceHash } = build(FULL)

    const out = await run()

    expect(fetchFilingFeeByRaceHash).toHaveBeenCalledWith('br-hash-1')
    expect(out).toEqual({
      filingFee: 100,
      filingRequirementsText: '$100 filing fee and 25 signatures',
      filingOfficeAddress: '1 Main St, Springfield, IL 62701',
      filingPhoneNumber: '555-0100',
      paperworkInstructions: 'File with the county clerk.',
      noDataFound: false,
    })
  })

  it('does not leak the extraction source (audit-only field)', async () => {
    const { run } = build(FULL)

    expect(await run()).not.toHaveProperty('extractionSource')
  })

  it('reports noDataFound when the lookup fails', async () => {
    const { run } = build(null)

    const out = await run()

    expect(out.noDataFound).toBe(true)
    expect(out.filingRequirementsText).toBeNull()
  })

  it('reports noDataFound when BallotReady has the race but no filing data', async () => {
    const { run } = build({
      filingFee: null,
      filingRequirementsText: null,
      extractionSource: null,
      filingOfficeAddress: null,
      filingPhoneNumber: null,
      paperworkInstructions: null,
    })

    expect((await run()).noDataFound).toBe(true)
  })

  it('is not noDataFound when only the office contact resolved', async () => {
    const { run } = build({
      filingFee: null,
      filingRequirementsText: null,
      extractionSource: null,
      filingOfficeAddress: null,
      filingPhoneNumber: '555-0100',
      paperworkInstructions: null,
    })

    expect((await run()).noDataFound).toBe(false)
  })

  it('rejects a smuggled race hash', () => {
    const { tool } = build(FULL)

    expect(() => tool.inputSchema.parse({ raceId: 'other-race' })).toThrow()
  })
})
