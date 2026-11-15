import type { EmailPublicMode } from '@goodparty_org/contracts'

// Win people hear from a campaign, Serve people from an office
// (docs/product-vocabulary.md).
const SOURCE: Record<EmailPublicMode, string> = {
  win: 'this campaign',
  serve: 'this office',
}

export const unsubscribeCopy = (
  mode: EmailPublicMode,
  senderName: string,
  unsubscribed: boolean,
  justUndone: boolean,
) =>
  unsubscribed
    ? {
        title: "You're unsubscribed.",
        caption: `You won't get more email from ${senderName} or ${SOURCE[mode]}.`,
      }
    : {
        title: `Stop email from ${senderName}?`,
        caption: justUndone
          ? `You're back on the list for ${SOURCE[mode]}.`
          : `You will stop hearing from ${SOURCE[mode]} by email.`,
      }
