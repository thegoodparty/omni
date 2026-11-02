import type {
  EmailBlockDraft,
  EmailThemeColors,
} from '@goodparty_org/contracts'

// What the system adds around the author's blocks. None of it is author
// content, so no author or agent can remove or edit it.
export type EmailTemplateContext = {
  senderName: string
  // Win shows "Paid for by"; Serve passes null and gets no line.
  paidForBy: string | null
  // The long_update masthead's date: the scheduled send time, or now. Shown
  // as the day in EMAIL_MASTHEAD_TIME_ZONE.
  sendDate: Date
}

export type LayoutProps = {
  colors: EmailThemeColors
  blocks: EmailBlockDraft[]
  context: EmailTemplateContext
}

export type RenderedEmailTemplate = {
  html: string
  text: string
  subject: string
}
