import { createVerify, X509Certificate } from 'node:crypto'
import { z } from 'zod'

export const SNS_HOST = 'sns.us-west-2.amazonaws.com'

const SnsBaseSchema = z.object({
  MessageId: z.string().min(1),
  TopicArn: z.string().min(1),
  Message: z.string(),
  Timestamp: z.string().min(1),
  SignatureVersion: z.enum(['1', '2']),
  Signature: z.string().min(1),
  SigningCertURL: z.string().min(1),
})

export const SnsMessageSchema = z.discriminatedUnion('Type', [
  SnsBaseSchema.extend({
    Type: z.literal('Notification'),
    Subject: z.string().optional(),
  }),
  SnsBaseSchema.extend({
    Type: z.literal('SubscriptionConfirmation'),
    Token: z.string().min(1),
    SubscribeURL: z.string().min(1),
  }),
  SnsBaseSchema.extend({
    Type: z.literal('UnsubscribeConfirmation'),
    Token: z.string().min(1),
    SubscribeURL: z.string().min(1),
  }),
])
export type SnsMessage = z.infer<typeof SnsMessageSchema>

export const isSnsUrl = (value: string, pathPattern: RegExp): boolean => {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.hostname === SNS_HOST &&
      !url.username &&
      !url.password &&
      (url.port === '' || url.port === '443') &&
      pathPattern.test(url.pathname)
    )
  } catch {
    return false
  }
}

// No query or fragment, so the certificate cache can't be filled with
// variants of one URL.
export const isSigningCertUrl = (value: string): boolean =>
  isSnsUrl(value, /^\/SimpleNotificationService-[A-Za-z0-9-]+\.pem$/) &&
  new URL(value).search === '' &&
  new URL(value).hash === ''

// The fields SNS signs, in the order AWS documents, each as "name\nvalue\n".
export const snsStringToSign = (message: SnsMessage): string => {
  const fields: [string, string | undefined][] =
    message.Type === 'Notification'
      ? [
          ['Message', message.Message],
          ['MessageId', message.MessageId],
          ['Subject', message.Subject],
          ['Timestamp', message.Timestamp],
          ['TopicArn', message.TopicArn],
          ['Type', message.Type],
        ]
      : [
          ['Message', message.Message],
          ['MessageId', message.MessageId],
          ['SubscribeURL', message.SubscribeURL],
          ['Timestamp', message.Timestamp],
          ['Token', message.Token],
          ['TopicArn', message.TopicArn],
          ['Type', message.Type],
        ]
  return fields
    .filter((field): field is [string, string] => field[1] !== undefined)
    .map(([name, value]) => `${name}\n${value}\n`)
    .join('')
}

export const verifySnsSignature = (
  message: SnsMessage,
  certificatePem: string,
): boolean => {
  try {
    const verifier = createVerify(
      message.SignatureVersion === '2' ? 'RSA-SHA256' : 'RSA-SHA1',
    )
    verifier.update(snsStringToSign(message), 'utf8')
    return verifier.verify(
      new X509Certificate(certificatePem).publicKey,
      message.Signature,
      'base64',
    )
  } catch {
    return false
  }
}
