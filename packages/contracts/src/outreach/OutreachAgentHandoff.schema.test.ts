import { describe, expect, it } from 'vitest'
import { AgentHandoffReportSchema } from './OutreachAgentHandoff.schema'

const vendor = {
  claimToken: 'tok',
  vendorCampaignName: '[Serve] Civic Jane Doe Austin W1 #42',
  sendingNumber: '+15125550100',
  audienceCount: 120,
}

describe('AgentHandoffReportSchema', () => {
  it('accepts a built report', () => {
    expect(
      AgentHandoffReportSchema.parse({ status: 'built', ...vendor }).status,
    ).toBe('built')
  })

  it('accepts a scheduled report with scheduledFor', () => {
    const parsed = AgentHandoffReportSchema.parse({
      status: 'scheduled',
      ...vendor,
      scheduledFor: '2026-11-05T15:00:00.000Z',
    })
    expect(parsed.status === 'scheduled' && parsed.scheduledFor).toBe(
      '2026-11-05T15:00:00.000Z',
    )
  })

  it('rejects a scheduled report without scheduledFor', () => {
    expect(
      AgentHandoffReportSchema.safeParse({ status: 'scheduled', ...vendor })
        .success,
    ).toBe(false)
  })

  it('accepts a needs_human report at every step, including login', () => {
    for (const step of ['login', 'schedule', 'confirm', 'replies']) {
      expect(
        AgentHandoffReportSchema.safeParse({
          status: 'needs_human',
          claimToken: 'tok',
          step,
          reason: 'stuck',
        }).success,
      ).toBe(true)
    }
  })

  it('rejects a needs_human reason over 500 characters', () => {
    const base = { status: 'needs_human', claimToken: 'tok', step: 'login' }
    expect(
      AgentHandoffReportSchema.safeParse({ ...base, reason: 'x'.repeat(500) })
        .success,
    ).toBe(true)
    expect(
      AgentHandoffReportSchema.safeParse({ ...base, reason: 'x'.repeat(501) })
        .success,
    ).toBe(false)
  })
})
