import { describe, expect, it } from 'vitest'
import { P2P_SCRIPT_MAX_LENGTH } from '@goodparty_org/contracts'
import { OutreachType } from '../../generated/prisma'
import { CreateOutreachSchema } from './createOutreachSchema'

const compliantScript =
  'Hello {first_name}, this is Johnny Goodparty. Vote for me. ' +
  'Paid for by Friends of Johnny. Reply STOP to opt out.'

const base = {
  campaignId: 1,
  outreachType: OutreachType.p2p,
  phoneListId: 10,
  date: '2026-08-02T04:00:00.000Z',
  script: compliantScript,
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

describe('CreateOutreachSchema p2p payment enforcement (ENG-10214)', () => {
  // A p2p create without `draft: true` used to hit the createP2pOutreach
  // path, which schedules a real Peerly job with no payment check. The
  // webapp always sends draft:true, so the schema is the server-side
  // backstop for anyone calling the endpoint directly.
  it('rejects a p2p create without draft:true', () => {
    expect(() =>
      CreateOutreachSchema.schema.parse({ ...base, draft: undefined }),
    ).toThrow(/draft/)
  })

  it('rejects a p2p create with draft:false', () => {
    expect(() =>
      CreateOutreachSchema.schema.parse({ ...base, draft: false }),
    ).toThrow(/draft/)
  })

  it('accepts a p2p create with draft:true', () => {
    expect(() =>
      CreateOutreachSchema.schema.parse({ ...base, draft: true }),
    ).not.toThrow()
  })

  it('still accepts non-p2p types without draft (text/robocall)', () => {
    for (const outreachType of [OutreachType.text, OutreachType.robocall]) {
      expect(() =>
        CreateOutreachSchema.schema.parse({
          ...base,
          outreachType,
          draft: undefined,
        }),
      ).not.toThrow()
    }
  })
})
