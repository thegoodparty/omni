import { createSign } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SnsMessage, snsStringToSign } from '../util/snsSignature.util'

export const TEST_TOPIC_ARN =
  'arn:aws:sns:us-west-2:000000000000:email-inbound-test'
export const TEST_CERT_URL = `https://sns.us-west-2.amazonaws.com/SimpleNotificationService-test.pem`

// A throwaway key and certificate made at test time, so no private key is
// committed.
export const makeSnsSigner = () => {
  const dir = mkdtempSync(join(tmpdir(), 'sns-test-'))
  try {
    const keyPath = join(dir, 'key.pem')
    const certPath = join(dir, 'cert.pem')
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-subj',
        '/CN=sns.test',
        '-days',
        '1',
      ],
      { stdio: 'ignore' },
    )
    const privateKey = readFileSync(keyPath, 'utf8')
    const certificatePem = readFileSync(certPath, 'utf8')
    const sign = (
      fields: Record<string, string | undefined>,
      version: '1' | '2' = '1',
    ): SnsMessage => {
      const unsigned = {
        MessageId: 'msg-1',
        TopicArn: TEST_TOPIC_ARN,
        Timestamp: '2026-10-28T00:00:00.000Z',
        SignatureVersion: version,
        SigningCertURL: TEST_CERT_URL,
        Signature: 'x',
        Type: 'Notification',
        Message: '{}',
        ...fields,
      }
      // The fixture builds a valid message of whichever Type was asked for.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const message = unsigned as SnsMessage
      const signer = createSign(version === '2' ? 'RSA-SHA256' : 'RSA-SHA1')
      signer.update(snsStringToSign(message), 'utf8')
      return { ...message, Signature: signer.sign(privateKey, 'base64') }
    }
    return { certificatePem, sign }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
