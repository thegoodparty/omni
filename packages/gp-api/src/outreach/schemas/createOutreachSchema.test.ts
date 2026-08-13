import { describe, expect, it } from 'vitest'
import { P2P_SCRIPT_MAX_LENGTH } from '@goodparty_org/contracts'
import { OutreachType } from '../../generated/prisma'
import { CreateOutreachSchema } from './createOutreachSchema'

const base = {
  campaignId: 1,
  outreachType: OutreachType.p2p,
  phoneListId: 10,
  date: '2026-08-02T04:00:00.000Z',
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
