import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import type { Organization } from '../../../generated/prisma'
import {
  PRO_FILTERING_REQUIRED_MESSAGE,
  type ContactsService,
} from '@/contacts/services/contacts.service'
import { buildListPrecinctsTool } from './listPrecincts.tool'

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
          voters: 812,
          value: 'GRAND TRAVERSE|01',
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

  it('relays the pro gate as a structured error, not a throw', async () => {
    const getPrecincts = vi.fn(() =>
      Promise.reject(new ForbiddenException(PRO_FILTERING_REQUIRED_MESSAGE)),
    )
    const result = await buildTool(getPrecincts).execute({})
    expect(result).toMatchObject({ error: expect.stringContaining('Pro') })
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
