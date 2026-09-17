import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import type { Organization } from '../../../generated/prisma'
import type { ContactsService } from '@/contacts/services/contacts.service'
import { buildListPrecinctsTool, NO_PRECINCT_LABEL } from './listPrecincts.tool'

const ORGANIZATION = { slug: 'eo-1' } as Organization

const buildTool = (getPrecincts: ContactsService['getPrecincts']) =>
  buildListPrecinctsTool({
    contacts: { getPrecincts },
    organization: ORGANIZATION,
  })

describe('buildListPrecinctsTool', () => {
  // The whole reason this is a tool rather than a catalog entry: the model
  // must never have to assemble the encoded pair itself.
  it('hands back the exact value the precincts filter takes', async () => {
    const getPrecincts = vi.fn(() =>
      Promise.resolve({
        options: [{ county: 'GRAND TRAVERSE', precinct: '01', voters: 812 }],
        truncated: false,
      }),
    )
    const result = await buildTool(getPrecincts).execute({})
    expect(result).toEqual({
      precincts: [
        {
          county: 'GRAND TRAVERSE',
          precinct: '01',
          label: '01',
          people: 812,
          value: 'GRAND TRAVERSE|01',
        },
      ],
      truncated: false,
    })
  })

  // The voter file leaves this bucket's name blank, and it is selectable
  // like any other — in New Hampshire it is every single record. Unlabelled,
  // a model either drops it or invents a name for it.
  it('labels the no-precinct-on-file bucket without altering its value', async () => {
    const getPrecincts = vi.fn(() =>
      Promise.resolve({
        options: [{ county: 'HILLSBOROUGH', precinct: '', voters: 91_284 }],
        truncated: false,
      }),
    )
    const result = await buildTool(getPrecincts).execute({})
    expect(result).toEqual({
      precincts: [
        {
          county: 'HILLSBOROUGH',
          precinct: '',
          label: NO_PRECINCT_LABEL,
          people: 91_284,
          // The filter still needs the encoded pair exactly as it is, blank
          // side and all — labelling it must not change what gets sent.
          value: 'HILLSBOROUGH|',
        },
      ],
      truncated: false,
    })
  })

  it('binds the organization server-side rather than taking one', async () => {
    const getPrecincts = vi.fn(() =>
      Promise.resolve({ options: [], truncated: false }),
    )
    await buildTool(getPrecincts).execute({})
    expect(getPrecincts).toHaveBeenCalledWith(ORGANIZATION)
  })

  // Truncation has to survive to the model: it is the difference between
  // "these are the precincts" and "these are some of them".
  it('passes truncation through', async () => {
    const getPrecincts = vi.fn(() =>
      Promise.resolve({ options: [], truncated: true }),
    )
    const result = await buildTool(getPrecincts).execute({})
    expect(result).toMatchObject({ truncated: true })
  })

  // The exact wording `assertProAccess` throws, which is NOT
  // PRO_FILTERING_REQUIRED_MESSAGE. Pinned as a literal on purpose: the
  // earlier version of this test mocked the constant instead, which made a
  // branch production could never reach look covered.
  const PRO_GATE_MESSAGE = 'This feature is only available for pro campaigns'

  it('relays the pro gate as a structured error, not a throw', async () => {
    const getPrecincts = vi.fn(() =>
      Promise.reject(new ForbiddenException(PRO_GATE_MESSAGE)),
    )
    const result = await buildTool(getPrecincts).execute({})
    expect(result).toEqual({
      error: `${PRO_GATE_MESSAGE}. Suggest upgrading to Pro.`,
    })
  })

  // Guards the regression directly: discriminating on the message rather
  // than the type sends the model the bare rejection with no upgrade hint.
  it('adds the upgrade hint whatever wording the gate throws', async () => {
    const getPrecincts = vi.fn(() =>
      Promise.reject(new ForbiddenException('some other refusal')),
    )
    const result = await buildTool(getPrecincts).execute({})
    expect(result).toEqual({
      error: 'some other refusal. Suggest upgrading to Pro.',
    })
  })

  it('relays a business-rule rejection as a structured error', async () => {
    const getPrecincts = vi.fn(() =>
      Promise.reject(new BadRequestException('No district on file')),
    )
    const result = await buildTool(getPrecincts).execute({})
    expect(result).toEqual({ error: 'No district on file' })
  })

  // Anything that is not a business-rule rejection is an outage, and the LLM
  // layer's tool-failure handling owns it.
  it('lets an unexpected failure propagate', async () => {
    const getPrecincts = vi.fn(() =>
      Promise.reject(new Error('people-api down')),
    )
    await expect(buildTool(getPrecincts).execute({})).rejects.toThrow(
      'people-api down',
    )
  })
})
