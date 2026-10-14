import { describe, expect, it } from 'vitest'
import { P2P_SCRIPT_MAX_LENGTH } from '@goodparty_org/contracts'
import { OutreachType } from '../../generated/prisma'
import { CreateOutreachSchema } from './createOutreachSchema'

const base = {
  campaignId: 1,
  outreachType: OutreachType.p2p,
  phoneListId: 10,
  date: '2026-08-02T04:00:00.000Z',
  draft: true,
}

describe('CreateOutreachSchema script newline normalization', () => {
  it('accepts a max-length script whose newlines arrive as CRLF', () => {
    const newlines = 40
    const clientScript =
      'a'.repeat(P2P_SCRIPT_MAX_LENGTH - newlines) + '\n'.repeat(newlines)
    const wireScript = clientScript.replace(/\n/g, '\r\n')
    expect(wireScript.length).toBeGreaterThan(P2P_SCRIPT_MAX_LENGTH)

    const parsed = CreateOutreachSchema.schema.parse({
      ...base,
      script: wireScript,
    })

    expect(parsed.script).toBe(clientScript)
  })

  it('rejects a script over the limit after normalization', () => {
    const script = 'a'.repeat(P2P_SCRIPT_MAX_LENGTH + 1)

    expect(() =>
      CreateOutreachSchema.schema.parse({ ...base, script }),
    ).toThrow()
  })
})

describe('CreateOutreachSchema p2p phoneListId requirement (Win SMS hold)', () => {
  // A valid p2p draft body minus phoneListId. The schema itself never
  // requires phoneListId (it has no user to evaluate the per-user
  // win_sms_hold_billing flag against) — OutreachService.create is the
  // single enforcement point; see outreach.service.test.ts.
  const draftBody = {
    campaignId: 1,
    outreachType: OutreachType.p2p,
    script: 'Hi {first_name}, Reply STOP to opt out. Paid for by X.',
    date: '2026-08-02T04:00:00.000Z',
    draft: true,
  }

  it('accepts a p2p draft with no phoneListId (pay before build)', () => {
    const parsed = CreateOutreachSchema.schema.parse(draftBody)
    expect(parsed.phoneListId).toBeUndefined()
  })
})
