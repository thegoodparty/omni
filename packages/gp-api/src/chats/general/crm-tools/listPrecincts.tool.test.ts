import { ForbiddenException, BadRequestException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import type { Organization } from '../../../generated/prisma'
import { PRO_FEATURE_REQUIRED_MESSAGE } from '@/contacts/services/contacts.service'
import { buildListPrecinctsTool } from './listPrecincts.tool'

const ORGANIZATION = { slug: 'eo-council' } as Organization

const buildTool = (getPrecincts: ReturnType<typeof vi.fn>) =>
  buildListPrecinctsTool({
    contacts: { getPrecincts } as never,
    organization: ORGANIZATION,
  })

describe('buildListPrecinctsTool', () => {
  // The whole point of the tool. A precinct number repeats across counties,
  // so the pair is the identity — a model handed a bare "02.1" cannot
  // reconstruct which county it belongs to, and the filter would match the
  // wrong people or nobody.
  it('returns the encoded county|precinct pair as the value to filter on', async () => {
    const getPrecincts = vi.fn(() =>
      Promise.resolve({
        options: [
          { county: 'Buncombe', precinct: '02.1', voters: 1234 },
          { county: 'Henderson', precinct: '02.1', voters: 77 },
        ],
        truncated: false,
      }),
    )

    const result = await buildTool(getPrecincts).execute({})

    expect(getPrecincts).toHaveBeenCalledWith(ORGANIZATION)
    expect(result).toEqual({
      precincts: [
        {
          value: 'Buncombe|02.1',
          county: 'Buncombe',
          precinct: '02.1',
          people: 1234,
        },
        {
          value: 'Henderson|02.1',
          county: 'Henderson',
          precinct: '02.1',
          people: 77,
        },
      ],
      truncated: false,
    })
  })

  // A real, selectable bucket — the people in that county with no precinct
  // on file. Dropping it would quietly make "everyone in the district"
  // unreachable through this dimension.
  it('keeps the empty-precinct bucket rather than dropping it', async () => {
    const getPrecincts = vi.fn(() =>
      Promise.resolve({
        options: [{ county: 'Buncombe', precinct: '', voters: 9 }],
        truncated: false,
      }),
    )

    const result = await buildTool(getPrecincts).execute({})

    expect(result).toMatchObject({
      precincts: [{ value: 'Buncombe|', precinct: '', people: 9 }],
    })
  })

  // This tool serves Serve as well as Win, and the Chief of Staff must never
  // repeat a Win noun back to an office holder.
  it('reports the count as people, never voters', async () => {
    const getPrecincts = vi.fn(() =>
      Promise.resolve({
        options: [{ county: 'Buncombe', precinct: '01.1', voters: 5 }],
        truncated: false,
      }),
    )

    const result = await buildTool(getPrecincts).execute({})

    expect(JSON.stringify(result)).not.toContain('voters')
  })

  it('passes the truncation flag through rather than implying a complete list', async () => {
    const getPrecincts = vi.fn(() =>
      Promise.resolve({ options: [], truncated: true }),
    )

    const result = await buildTool(getPrecincts).execute({})

    expect(result).toEqual({ precincts: [], truncated: true })
  })

  // The message assertProAccess ACTUALLY throws, imported rather than
  // written out. An earlier version of this test constructed the filtering
  // gate's message instead, which getPrecincts never raises — so it passed
  // while the upgrade branch it claimed to cover could not run.
  it('relays the pro gate as a structured error with an upgrade suggestion', async () => {
    const getPrecincts = vi.fn(() =>
      Promise.reject(new ForbiddenException(PRO_FEATURE_REQUIRED_MESSAGE)),
    )

    const result = await buildTool(getPrecincts).execute({})

    expect(result).toEqual({
      error: expect.stringContaining('Suggest upgrading to Pro'),
    })
  })

  // The other side of that: a refusal which is not a pro gate must not
  // acquire an upgrade pitch, or every failure starts selling.
  it('does not attach an upgrade suggestion to an unrelated refusal', async () => {
    const getPrecincts = vi.fn(() =>
      Promise.reject(new ForbiddenException('Some other refusal')),
    )

    const result = await buildTool(getPrecincts).execute({})

    expect(result).toEqual({ error: 'Some other refusal' })
  })

  // An org whose office has no linked district cannot enumerate anything,
  // and that is an answer the model can relay rather than a tool failure.
  it('relays an unresolvable district as a structured error', async () => {
    const getPrecincts = vi.fn(() =>
      Promise.reject(new BadRequestException('VOTER_DATA_UNAVAILABLE')),
    )

    const result = await buildTool(getPrecincts).execute({})

    expect(result).toEqual({ error: 'VOTER_DATA_UNAVAILABLE' })
  })

  it('takes no input, so there is nothing for the model to get wrong', () => {
    expect(
      buildTool(vi.fn()).inputSchema.safeParse({ county: 'Buncombe' }).success,
    ).toBe(false)
  })
})
