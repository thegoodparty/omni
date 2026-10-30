import { Heading, Text } from '@react-email/components'
import { format } from 'date-fns'
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

// A theme-color masthead with the level 1 heading, the sender and the date,
// then left-aligned reading text. Below the masthead the theme color is only
// an accent.
export const LongUpdateLayout = ({ colors, blocks, context }: LayoutProps) => {
  const masthead = blocks.find((b) => b.type === 'heading' && b.level === 1)
  const image = blocks.find((b) => b.type === 'image')
  const rest = blocks.filter((b) => b !== masthead && b !== image)
  return (
    <>
      <Block
        background={colors.header}
        className="em-header"
        padding="28px 40px 24px"
      >
        {masthead?.type === 'heading' ? (
          <Heading
            as="h1"
            className="em-header-text"
            style={{
              margin: '0 0 8px',
              color: colors.headerText,
              fontSize: 28,
              lineHeight: '35px',
              fontWeight: 800,
            }}
          >
            {masthead.text}
          </Heading>
        ) : null}
        <Text
          className="em-header-text"
          style={{
            margin: 0,
            color: colors.headerText,
            fontSize: 14,
            lineHeight: '20px',
          }}
        >
          {`${context.senderName} · ${format(context.sendDate, 'MMMM d, yyyy')}`}
        </Text>
      </Block>
      <EmailRule colors={colors} height={3} />
      {image?.type === 'image' ? (
        <EmailFullImage url={image.url} alt={image.alt} />
      ) : null}
      <EmailBodyBlock colors={colors} padding="32px 40px 16px">
        {rest.map((block, index) => {
          switch (block.type) {
            case 'heading':
              return (
                <EmailHeading
                  key={index}
                  colors={colors}
                  text={block.text}
                  level={2}
                />
              )
            case 'paragraph':
              return (
                <EmailParagraph
                  key={index}
                  colors={colors}
                  text={block.text}
                  fontSize={17}
                  lineHeight={28}
                />
              )
            case 'divider':
              return <EmailDivider key={index} colors={colors} />
            case 'button':
              return (
                <EmailButton
                  key={index}
                  label={block.label}
                  url={block.url}
                  background={colors.cta}
                  backgroundClass="em-cta"
                  textColor={colors.ctaText}
                  textClass="em-cta-text"
                />
              )
            case 'image':
              return null
          }
        })}
      </EmailBodyBlock>
      <EmailFooter colors={colors} context={context} />
    </>
  )
}
