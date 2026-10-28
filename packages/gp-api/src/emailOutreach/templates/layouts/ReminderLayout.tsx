import {
  EmailAccentBlock,
  EmailBodyBlock,
  EmailButton,
  EmailFooter,
  EmailHeader,
  EmailImage,
  EmailParagraphs,
  type LayoutProps,
} from '../components'

export const ReminderLayout = ({ colors, content }: LayoutProps) => (
  <>
    <EmailHeader colors={colors} senderName={content.footer.senderName} />
    {content.headline ? (
      <EmailAccentBlock colors={colors} text={content.headline} />
    ) : null}
    <EmailBodyBlock colors={colors}>
      <EmailParagraphs colors={colors} text={content.body} />
      {content.button ? (
        <EmailButton
          colors={colors}
          label={content.button.label}
          url={content.button.url}
        />
      ) : null}
    </EmailBodyBlock>
    {content.imageUrl ? <EmailImage url={content.imageUrl} /> : null}
    <EmailFooter colors={colors} footer={content.footer} />
  </>
)
