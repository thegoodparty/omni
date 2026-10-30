import type { LayoutProps } from '../emailTemplate.types'
import {
  Block,
  EmailBodyBlock,
  EmailButton,
  EmailFooter,
  EmailFullImage,
  EmailHeading,
  EmailParagraph,
  EmailRule,
} from '../components'

// Bold and centered: a theme-color strip, the photo edge to edge, a big
// headline and the button on a band of the theme color.
export const ShortCtaLayout = ({ colors, blocks, context }: LayoutProps) => {
  const image = blocks.flatMap((b) => (b.type === 'image' ? [b] : []))[0]
  const heading = blocks.flatMap((b) => (b.type === 'heading' ? [b] : []))[0]
  const button = blocks.flatMap((b) => (b.type === 'button' ? [b] : []))[0]
  const paragraphs = blocks.flatMap((b) => (b.type === 'paragraph' ? [b] : []))
  return (
    <>
      <EmailRule colors={colors} height={6} />
      {image ? <EmailFullImage url={image.url} alt={image.alt} /> : null}
      <EmailBodyBlock colors={colors} align="center" padding="36px 40px 20px">
        {heading ? (
          <EmailHeading
            colors={colors}
            text={heading.text}
            level={1}
            size={36}
            align="center"
          />
        ) : null}
        {paragraphs.map((paragraph, index) => (
          <EmailParagraph
            key={index}
            colors={colors}
            text={paragraph.text}
            align="center"
            fontSize={17}
            lineHeight={28}
          />
        ))}
      </EmailBodyBlock>
      {button ? (
        <Block
          background={colors.rule}
          className="em-rule"
          align="center"
          padding="32px 24px"
        >
          <EmailButton
            label={button.label}
            url={button.url}
            background={colors.accent}
            backgroundClass="em-accent"
            textColor={colors.accentText}
            textClass="em-accent-text"
            align="center"
            large
          />
        </Block>
      ) : null}
      <EmailFooter colors={colors} context={context} align="center" />
    </>
  )
}
