import { describe, expect, it } from 'vitest'
import { SubscribeEmailSchema } from './subscribeEmail.schema'

const base = { email: 'subscriber@example.com', uri: 'https://goodparty.org' }

describe('SubscribeEmailSchema', () => {
  it('accepts a valid HubSpot form GUID (UUID) formId', () => {
    const parsed = SubscribeEmailSchema.schema.parse({
      ...base,
      formId: '5d84452a-01df-422b-9734-580148677d2c',
    })

    expect(parsed.formId).toBe('5d84452a-01df-422b-9734-580148677d2c')
  })

  it('rejects a non-UUID formId (submit-path injection)', () => {
    expect(
      SubscribeEmailSchema.schema.safeParse({ ...base, formId: '../../evil' })
        .success,
    ).toBe(false)
  })

  it('strips the removed additionalFields blob instead of forwarding it', () => {
    const parsed = SubscribeEmailSchema.schema.parse({
      ...base,
      additionalFields: '[{"name":"x","value":"y","objectTypeId":"0-2"}]',
    })

    expect('additionalFields' in parsed).toBe(false)
  })
})
