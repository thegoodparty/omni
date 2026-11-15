import { describe, expect, it } from 'vitest'
import { makeSnsSigner } from '../tests/snsFixtures'
import {
  isSigningCertUrl,
  isSnsUrl,
  verifySnsSignature,
} from './snsSignature.util'

const { certificatePem, sign } = makeSnsSigner()
const other = makeSnsSigner()

describe('verifySnsSignature', () => {
  it.each(['1', '2'] as const)('accepts a valid v%s signature', (version) => {
    expect(verifySnsSignature(sign({}, version), certificatePem)).toBe(true)
  })

  it('signs the subject when there is one', () => {
    const message = sign({ Subject: 'Amazon SES Email Receipt Notification' })
    expect(verifySnsSignature(message, certificatePem)).toBe(true)
    const swapped = {
      ...sign({ Subject: 'tampered' }),
      Signature: message.Signature,
    }
    expect(verifySnsSignature(swapped, certificatePem)).toBe(false)
  })

  it('verifies a subscription confirmation', () => {
    const message = sign({
      Type: 'SubscriptionConfirmation',
      Token: 'abc',
      SubscribeURL: 'https://sns.us-west-2.amazonaws.com/?Action=Confirm',
    })
    expect(verifySnsSignature(message, certificatePem)).toBe(true)
  })

  it('rejects a tampered body', () => {
    expect(
      verifySnsSignature(
        { ...sign({}), Message: '{"evil":true}' },
        certificatePem,
      ),
    ).toBe(false)
  })

  it('rejects a signature from another certificate', () => {
    expect(verifySnsSignature(sign({}), other.certificatePem)).toBe(false)
  })

  it('rejects a certificate that is not a certificate', () => {
    expect(verifySnsSignature(sign({}), 'not a cert')).toBe(false)
  })
})

describe('certificate URLs', () => {
  it('accepts the us-west-2 SNS host', () => {
    expect(
      isSigningCertUrl(
        'https://sns.us-west-2.amazonaws.com/SimpleNotificationService-abc123.pem',
      ),
    ).toBe(true)
  })

  it.each([
    'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-a.pem',
    'http://sns.us-west-2.amazonaws.com/SimpleNotificationService-a.pem',
    'https://sns.us-west-2.amazonaws.com.evil.com/SimpleNotificationService-a.pem',
    'https://evil.com/sns.us-west-2.amazonaws.com/SimpleNotificationService-a.pem',
    'https://user@sns.us-west-2.amazonaws.com/SimpleNotificationService-a.pem',
    'https://sns.us-west-2.amazonaws.com:8443/SimpleNotificationService-a.pem',
    'https://sns.us-west-2.amazonaws.com/other.pem',
    'https://sns.us-west-2.amazonaws.com/SimpleNotificationService-a.pem?n=1',
    'not a url',
  ])('rejects %s', (url) => {
    expect(isSigningCertUrl(url)).toBe(false)
  })

  it('only follows a subscribe URL on the SNS host', () => {
    expect(isSnsUrl('https://sns.us-west-2.amazonaws.com/?x=1', /^\/$/)).toBe(
      true,
    )
    expect(isSnsUrl('https://evil.com/?x=1', /^\/$/)).toBe(false)
  })
})
