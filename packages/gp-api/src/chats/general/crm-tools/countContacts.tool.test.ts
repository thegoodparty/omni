import { BadGatewayException, BadRequestException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import type { Organization } from '../../../generated/prisma'
import {
  PRO_FILTERING_REQUIRED_MESSAGE,
  type ContactsService,
} from '@/contacts/services/contacts.service'
import { DATA_SOURCE_ROUTING_RULES } from '@/llm/tools/dataSourceRouting'
import { buildCountContactsTool } from './countContacts.tool'

const ORGANIZATION = { slug: 'win-campaign' } as Organization

const buildTool = (countContacts: ContactsService['countContacts']) =>
  buildCountContactsTool({
    contacts: { countContacts },
    organization: ORGANIZATION,
  })

describe('buildCountContactsTool', () => {
  it('counts via the same service method the count route uses', async () => {
    const countContacts = vi.fn(() => Promise.resolve({ count: 1234 }))
    const tool = buildTool(countContacts)
    const input = tool.inputSchema.parse({ hasCellPhone: true })
    const result = await tool.execute(input)
    expect(countContacts).toHaveBeenCalledWith(input, ORGANIZATION)
    expect(result).toEqual({ count: 1234 })
  })

  it('rejects the legacy registration keys the filter engine ignores', () => {
    const tool = buildTool(vi.fn(() => Promise.resolve({ count: 0 })))
    expect(
      tool.inputSchema.safeParse({ registeredVoterTrue: true }).success,
    ).toBe(false)
    expect(
      tool.inputSchema.safeParse({ registeredVoterFalse: true }).success,
    ).toBe(false)
  })

  it('rejects a malformed filter at the input schema', () => {
    const tool = buildTool(vi.fn(() => Promise.resolve({ count: 0 })))
    expect(tool.inputSchema.safeParse({ age18_25: 'yes' }).success).toBe(false)
    expect(
      tool.inputSchema.safeParse({
        activityConditions: [
          // voicemail_left is a robocall outcome; invalid on the text channel
          { outreachType: 'text', actions: ['voicemail_left'] },
        ],
      }).success,
    ).toBe(false)
  })

  it('surfaces the inherited non-Pro rejection as a Pro-upgrade tool error', async () => {
    const countContacts = vi.fn(() =>
      Promise.reject(new BadRequestException(PRO_FILTERING_REQUIRED_MESSAGE)),
    )
    const result = await buildTool(countContacts).execute({})
    expect(result).toEqual({
      error: expect.stringContaining(PRO_FILTERING_REQUIRED_MESSAGE),
    })
    expect(result).toEqual({
      error: expect.stringContaining('upgrading to Pro'),
    })
  })

  it('surfaces the Serve party rejection as a tool error, never a count', async () => {
    const partyRejection = new BadRequestException(
      'Political party filtering is not available for this organization',
    )
    const countContacts = vi.fn(() => Promise.reject(partyRejection))
    const result = await buildTool(countContacts).execute({
      partyDemocrat: true,
    })
    expect(result).toEqual({ error: partyRejection.message })
  })

  it('lets non-business failures (people-api outage) propagate', async () => {
    const outage = new BadGatewayException('Failed to count from people API')
    const countContacts = vi.fn(() => Promise.reject(outage))
    await expect(buildTool(countContacts).execute({})).rejects.toBe(outage)
  })

  it('carries the cross-catalog routing rules in its description', () => {
    const tool = buildTool(vi.fn(() => Promise.resolve({ count: 0 })))
    expect(tool.description).toContain(DATA_SOURCE_ROUTING_RULES)
  })
})
