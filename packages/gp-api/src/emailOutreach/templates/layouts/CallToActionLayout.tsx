import {
  EmailBodyBlock,
  EmailButton,
  EmailFooter,
  EmailHeader,
  EmailHeadline,
  EmailImage,
  EmailParagraphs,
  type LayoutProps,
} from '../components'

export const CallToActionLayout = ({ colors, content }: LayoutProps) => (
  <>
    <EmailHeader
      colors={colors}
      senderName={content.footer.senderName}
      align="center"
    />
    {content.imageUrl ? <EmailImage url={content.imageUrl} /> : null}
    <EmailBodyBlock colors={colors} align="center">
      {content.headline ? (
        <EmailHeadline
          colors={colors}
          text={content.headline}
          size={34}
          align="center"
        />
      ) : null}
      <EmailParagraphs colors={colors} text={content.body} align="center" />
      {content.button ? (
        <EmailButton
          colors={colors}
          label={content.button.label}
          url={content.button.url}
          align="center"
          large
        />
      ) : null}
    </EmailBodyBlock>
    <EmailFooter colors={colors} footer={content.footer} />
  </>
)
