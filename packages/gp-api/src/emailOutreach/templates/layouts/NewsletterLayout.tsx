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

export const NewsletterLayout = ({ colors, content }: LayoutProps) => (
  <>
    <EmailHeader colors={colors} senderName={content.footer.senderName} />
    {content.imageUrl ? <EmailImage url={content.imageUrl} /> : null}
    <EmailBodyBlock colors={colors}>
      {content.headline ? (
        <EmailHeadline colors={colors} text={content.headline} />
      ) : null}
      <EmailParagraphs colors={colors} text={content.body} />
      {content.button ? (
        <EmailButton
          colors={colors}
          label={content.button.label}
          url={content.button.url}
        />
      ) : null}
    </EmailBodyBlock>
    <EmailFooter colors={colors} footer={content.footer} />
  </>
)
