import type { LayoutProps } from '../emailTemplate.types'
import {
  Block,
  EmailBodyBlock,
  EmailButton,
  EmailDivider,
  EmailFooter,
  EmailFullImage,
  EmailHeading,
  EmailParagraph,
  EmailRule,
} from '../components'

// Bold and centered: a theme-color strip, the photo edge to edge, the text
// with a big headline, and the button on a band of the theme color.
export const ShortCtaLayout = ({ colors, blocks, context }: LayoutProps) => {
  const image = blocks.flatMap((b) => (b.type === 'image' ? [b] : []))[0]
  const button = blocks.flatMap((b) => (b.type === 'button' ? [b] : []))[0]
  const rest = blocks.filter((b) => b !== image && b !== button)
  return (
    <>
      <EmailRule colors={colors} height={6} />
      {image ? <EmailFullImage url={image.url} alt={image.alt} /> : null}
      <EmailBodyBlock colors={colors} align="center" padding="36px 40px 20px">
        {rest.map((block, index) => {
          switch (block.type) {
            case 'heading':
              return (
                <EmailHeading
                  key={index}
                  colors={colors}
                  text={block.text}
                  level={block.level}
                  size={block.level === 1 ? 36 : undefined}
                  align="center"
                />
              )
            case 'paragraph':
              return (
                <EmailParagraph
                  key={index}
                  colors={colors}
                  text={block.text}
                  align="center"
                  fontSize={17}
                  lineHeight={28}
                />
              )
            case 'divider':
              return <EmailDivider key={index} colors={colors} />
            case 'image':
            case 'button':
              return null
          }
        })}
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
