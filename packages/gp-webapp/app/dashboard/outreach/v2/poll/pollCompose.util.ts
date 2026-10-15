import { mergeTagToken } from '@goodparty_org/contracts'

const OPT_OUT_LINE = 'Reply STOP to opt out.'

// The sender line gp-api composes around the question: the official's name
// and office, joined the same way, so the preview is the text people get.
export const pollSenderLine = (name: string, office: string): string =>
  [name, office].filter(Boolean).join(', ')

export const pollIntro = (name: string, office: string): string =>
  `Hi ${mergeTagToken('first_name', 'serve')}, this is ${pollSenderLine(name, office)}.`

export const pollFooter = OPT_OUT_LINE

export const composePollMessage = (
  question: string,
  name: string,
  office: string,
): string => `${pollIntro(name, office)} ${question} ${pollFooter}`
