/**
 * Sends every email layout in every theme to team inboxes through real dev
 * SES, for the manual rendering pass in Gmail, Outlook and Apple Mail
 * (Track E, E2). The HTML is the real `renderEmailTemplate` output, with its
 * merge variables filled the way the send sweep fills them.
 *
 * It sends only to `@goodparty.org` and the SES mailbox simulator, the same
 * allowlist dev sends use, and refuses any other address. It creates the
 * tenant `dev-e2-render-check-<run>` and deletes it at the end unless `--keep`
 * is passed. Emails carry no `outreachEmailId` tag, so they stay out of every
 * send's CloudWatch numbers.
 *
 * Usage (a dev session with SES access, e.g. /breakglass):
 *   npx tsx scripts/send-all-email-templates.ts --confirm-dev --to you@goodparty.org
 *
 * Options:
 *   --confirm-dev           Required. Refuses to run without it.
 *   --to <a,b>              Required. Comma-separated inboxes.
 *   --mode win|serve|both   Footer variant. Win shows "Paid for by". Default win.
 *   --image-url <https url> Header image. Default is a placeholder image.
 *   --no-image              Leave the image out.
 *   --dry-run               Render and list the emails without sending.
 *   --keep                  Leave the tenant in place.
 */

import {
  CreateTenantCommand,
  CreateTenantResourceAssociationCommand,
  DeleteTenantCommand,
  SendEmailCommand,
  SESv2Client,
} from '@aws-sdk/client-sesv2'
import {
  EMAIL_LAYOUTS,
  EMAIL_THEMES,
  EmailLayoutKeySchema,
  EmailThemeKeySchema,
  type EmailLayoutKey,
  type EmailThemeKey,
} from '@goodparty_org/contracts'
import {
  EMAIL_VARIABLES,
  emailVariableToken,
} from '../src/emailOutreach/templates/emailTemplate.const'
import { renderEmailTemplate } from '../src/emailOutreach/templates/renderEmailTemplate'

const REGION = 'us-west-2'
const IDENTITY = 'outreachmail-dev.goodparty.org'
const CONFIGURATION_SET = 'outreach-dev'
const FROM = `"GoodParty template check" <render-check@${IDENTITY}>`
const ALLOWED_DOMAINS = ['goodparty.org', 'simulator.amazonses.com']
const PLACEHOLDER_IMAGE = 'https://placehold.co/1200x600.png'
const SEND_DELAY_MS = 200

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const stringArg = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? undefined : args[index + 1]
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const log = (message: string) => console.log(message)

const parseRecipients = (): string[] => {
  const recipients = (stringArg('to') ?? '')
    .split(',')
    .map((address) => address.trim().toLowerCase())
    .filter(Boolean)
  if (recipients.length === 0) throw new Error('--to needs at least one inbox')
  for (const address of recipients) {
    const domain = address.slice(address.lastIndexOf('@') + 1)
    if (!address.includes('@') || !ALLOWED_DOMAINS.includes(domain)) {
      throw new Error(
        `${address} is not allowed. Dev sends reach only ${ALLOWED_DOMAINS.join(' and ')}`,
      )
    }
  }
  return recipients
}

const parseModes = (): Array<'win' | 'serve'> => {
  const mode = stringArg('mode') ?? 'win'
  if (mode === 'both') return ['win', 'serve']
  if (mode === 'win' || mode === 'serve') return [mode]
  throw new Error('--mode must be win, serve or both')
}

const BODY = [
  'Hi {{first_name}},',
  'Election Day is closer than it feels. Here is where we stand, what we are doing this week, and how you can help. A longer paragraph makes sure the layout wraps text the way a real email will, across a few lines on a phone.',
  'Thank you for being part of this. Reply to this email with questions.',
].join('\n\n')

const buildContent = (
  layout: EmailLayoutKey,
  theme: EmailThemeKey,
  mode: 'win' | 'serve',
  imageUrl: string | null,
) => ({
  subject: `[Render check] ${layout} / ${theme} / ${mode}`,
  headline: `${EMAIL_LAYOUTS[layout].label} in ${EMAIL_THEMES[theme].label}`,
  body: BODY,
  imageUrl,
  button: { label: 'Get involved', url: 'https://goodparty.org' },
  footer: {
    senderName: 'Jane Candidate',
    paidForBy: mode === 'win' ? 'Jane for Springfield' : null,
  },
})

const main = async () => {
  if (!flag('confirm-dev')) {
    throw new Error(
      'Refusing to run without --confirm-dev. This sends real SES email in dev.',
    )
  }
  const recipients = parseRecipients()
  const modes = parseModes()
  const imageUrl = flag('no-image')
    ? null
    : (stringArg('image-url') ?? PLACEHOLDER_IMAGE)
  const dryRun = flag('dry-run')

  const layouts = EmailLayoutKeySchema.options
  const themes = EmailThemeKeySchema.options
  const combos = modes.flatMap((mode) =>
    layouts.flatMap((layout) =>
      themes.map((theme) => ({ layout, theme, mode })),
    ),
  )
  log(
    `${combos.length} emails per inbox, ${combos.length * recipients.length} total`,
  )

  const rendered = await Promise.all(
    combos.map(async (combo) => ({
      combo,
      email: await renderEmailTemplate(
        combo.layout,
        combo.theme,
        buildContent(combo.layout, combo.theme, combo.mode, imageUrl),
      ),
    })),
  )
  if (dryRun) {
    for (const { email } of rendered) log(`would send: ${email.subject}`)
    return
  }

  const ses = new SESv2Client({ region: REGION })
  const runId = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const tenantName = `dev-e2-render-check-${runId}`
  const tenant = await ses.send(
    new CreateTenantCommand({ TenantName: tenantName }),
  )
  const accountId = tenant.TenantArn?.split(':').at(4)
  if (!accountId) throw new Error(`Unexpected tenant ARN ${tenant.TenantArn}`)
  for (const resource of [
    `identity/${IDENTITY}`,
    `configuration-set/${CONFIGURATION_SET}`,
  ]) {
    await ses.send(
      new CreateTenantResourceAssociationCommand({
        TenantName: tenantName,
        ResourceArn: `arn:aws:ses:${REGION}:${accountId}:${resource}`,
      }),
    )
  }
  log(`tenant ${tenantName} ready`)

  let sent = 0
  const failures: string[] = []
  try {
    for (const recipient of recipients) {
      const values = {
        [EMAIL_VARIABLES.firstName]: recipient.split('@')[0] ?? 'there',
        [EMAIL_VARIABLES.lastName]: 'Tester',
        [EMAIL_VARIABLES.unsubscribeUrl]:
          'https://app-dev.goodparty.org/email/unsubscribe/test-send',
      }
      const fill = (template: string, encode: (v: string) => string): string =>
        Object.entries(values).reduce(
          (result, [name, value]) =>
            result.replaceAll(emailVariableToken(name), encode(value)),
          template,
        )
      for (const { combo, email } of rendered) {
        try {
          await ses.send(
            new SendEmailCommand({
              FromEmailAddress: FROM,
              ConfigurationSetName: CONFIGURATION_SET,
              TenantName: tenantName,
              Destination: { ToAddresses: [recipient] },
              Content: {
                Simple: {
                  Subject: {
                    Data: fill(email.subject, (v) => v),
                    Charset: 'UTF-8',
                  },
                  Body: {
                    Html: {
                      Data: fill(email.html, escapeHtml),
                      Charset: 'UTF-8',
                    },
                    Text: {
                      Data: fill(email.text, (v) => v),
                      Charset: 'UTF-8',
                    },
                  },
                },
              },
            }),
          )
          sent += 1
          log(
            `sent ${combo.layout} / ${combo.theme} / ${combo.mode} to ${recipient}`,
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          failures.push(
            `${combo.layout} / ${combo.theme} / ${combo.mode} to ${recipient}: ${message}`,
          )
        }
        await sleep(SEND_DELAY_MS)
      }
    }
  } finally {
    if (flag('keep')) {
      log(`--keep: leaving tenant ${tenantName}`)
    } else {
      await ses
        .send(new DeleteTenantCommand({ TenantName: tenantName }))
        .then(() => log('tenant deleted'))
        .catch((error: Error) => log(`DeleteTenant failed: ${error.message}`))
    }
  }
  log(`\n${sent} sent, ${failures.length} failed`)
  for (const failure of failures) log(`FAILED ${failure}`)
  if (failures.length > 0) process.exit(1)
}

main().catch((error: Error) => {
  console.error('FAILED', error.message)
  process.exit(1)
})
