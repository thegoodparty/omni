import {
  Body,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Text,
} from '@react-email/components'
import type { ReactNode } from 'react'
import type { EmailThemeColors } from '@goodparty_org/contracts'
import { EMAIL_POSTAL_ADDRESS, EMAIL_VARIABLES } from './emailTemplate.const'
import { emailVariableToken } from './emailTemplate.const'
import type { EmailTemplateContext } from './emailTemplate.types'

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

const CARD_WIDTH = 600

type Align = 'left' | 'center'

// bgcolor is a legacy attribute that email clients still honor and React's
// types omit.
const bgcolor = (color: string): { bgcolor: string } => ({ bgcolor: color })

// Clients that recolor emails in dark mode leave an element alone when it
// carries a solid bgcolor attribute plus a background-color in CSS, so every
// block below sets both, and the dark-mode media query repeats the light
// colors with !important for clients that honor it.
const darkModeCss = (colors: EmailThemeColors): string => {
  const rules: [string, string, string][] = [
    ['em-bg', 'background-color', colors.bg],
    ['em-card', 'background-color', colors.card],
    ['em-header', 'background-color', colors.header],
    ['em-rule', 'background-color', colors.rule],
    ['em-divider', 'background-color', colors.divider],
    ['em-accent', 'background-color', colors.accent],
    ['em-cta', 'background-color', colors.cta],
    ['em-header-text', 'color', colors.headerText],
    ['em-headline', 'color', colors.headline],
    ['em-subheading', 'color', colors.rule],
    ['em-body', 'color', colors.body],
    ['em-meta', 'color', colors.meta],
    ['em-cta-text', 'color', colors.ctaText],
    ['em-cta-link', 'color', colors.cta],
    ['em-accent-text', 'color', colors.accentText],
  ]
  const declarations = rules
    .map(
      ([name, property, value]) => `.${name}{${property}:${value} !important}`,
    )
    .join('')
  return `:root{color-scheme:light only;supported-color-schemes:light only}@media (prefers-color-scheme:dark){${declarations}}`
}

type BlockProps = {
  background: string
  className: string
  children?: ReactNode
  align?: Align
  padding?: string
  height?: number
}

export const Block = ({
  background,
  className,
  children,
  align = 'left',
  padding = '0',
  height,
}: BlockProps) => (
  <table
    role="presentation"
    width="100%"
    cellPadding={0}
    cellSpacing={0}
    border={0}
    {...bgcolor(background)}
    className={className}
    style={{ backgroundColor: background, width: '100%' }}
  >
    <tbody>
      <tr>
        <td
          align={align}
          {...bgcolor(background)}
          className={className}
          height={height}
          style={{
            backgroundColor: background,
            padding,
            textAlign: align,
            ...(height
              ? { height, lineHeight: `${height}px`, fontSize: 1 }
              : {}),
          }}
        >
          {children ?? (height ? <>&nbsp;</> : null)}
        </td>
      </tr>
    </tbody>
  </table>
)

// `background` is the page around the card: the theme's tint, or the card
// color for a layout that should read like a plain email.
export const EmailShell = ({
  colors,
  subject,
  previewText,
  background,
  children,
}: {
  colors: EmailThemeColors
  subject: string
  previewText?: string
  background: 'bg' | 'card'
  children: ReactNode
}) => {
  const page = colors[background]
  const pageClass = background === 'bg' ? 'em-bg' : 'em-card'
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light only" />
        <title>{subject}</title>
        <style>{darkModeCss(colors)}</style>
      </Head>
      {previewText ? <Preview>{previewText}</Preview> : null}
      <Body
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: page,
          fontFamily: FONT_STACK,
        }}
        {...bgcolor(page)}
        className={pageClass}
      >
        <Block background={page} className={pageClass} padding="24px 12px">
          <table
            role="presentation"
            width={CARD_WIDTH}
            cellPadding={0}
            cellSpacing={0}
            border={0}
            {...bgcolor(colors.card)}
            className="em-card"
            style={{
              width: '100%',
              maxWidth: CARD_WIDTH,
              backgroundColor: colors.card,
              margin: '0 auto',
            }}
          >
            <tbody>
              <tr>
                <td style={{ padding: 0 }}>{children}</td>
              </tr>
            </tbody>
          </table>
        </Block>
      </Body>
    </Html>
  )
}

export const EmailRule = ({
  colors,
  height,
}: {
  colors: EmailThemeColors
  height: number
}) => <Block background={colors.rule} className="em-rule" height={height} />

// Edge to edge across the card.
export const EmailFullImage = ({ url, alt }: { url: string; alt: string }) => (
  <Img
    src={url}
    alt={alt}
    width={String(CARD_WIDTH)}
    style={{
      display: 'block',
      width: '100%',
      maxWidth: CARD_WIDTH,
      height: 'auto',
    }}
  />
)

// Like a photo pasted into a normal email: padded and centered, narrower
// than the text column.
export const EmailInsetImage = ({ url, alt }: { url: string; alt: string }) => (
  <table
    role="presentation"
    width="100%"
    cellPadding={0}
    cellSpacing={0}
    border={0}
    style={{ width: '100%', margin: '8px 0 24px' }}
  >
    <tbody>
      <tr>
        <td align="center">
          <Img
            src={url}
            alt={alt}
            width="416"
            style={{
              display: 'block',
              width: '78%',
              maxWidth: 416,
              height: 'auto',
              margin: '0 auto',
              borderRadius: 4,
            }}
          />
        </td>
      </tr>
    </tbody>
  </table>
)

export const EmailHeading = ({
  colors,
  text,
  level,
  align = 'left',
  size,
}: {
  colors: EmailThemeColors
  text: string
  level: 1 | 2
  align?: Align
  size?: number
}) => {
  const fontSize = size ?? (level === 1 ? 28 : 21)
  return (
    <Heading
      as={level === 1 ? 'h1' : 'h2'}
      className={level === 1 ? 'em-headline' : 'em-subheading'}
      style={{
        margin: level === 1 ? '0 0 16px' : '28px 0 12px',
        color: level === 1 ? colors.headline : colors.rule,
        fontSize,
        lineHeight: `${Math.round(fontSize * 1.25)}px`,
        fontWeight: level === 1 ? 800 : 700,
        textAlign: align,
      }}
    >
      {text}
    </Heading>
  )
}

// A blank line in the text starts a new paragraph and a single line break a
// new line.
export const EmailParagraph = ({
  colors,
  text,
  align = 'left',
  fontSize = 16,
  lineHeight = 26,
}: {
  colors: EmailThemeColors
  text: string
  align?: Align
  fontSize?: number
  lineHeight?: number
}) => (
  <>
    {text
      .split(/\n{2,}/)
      .filter((paragraph) => paragraph.trim().length > 0)
      .map((paragraph, index) => (
        <Text
          key={index}
          className="em-body"
          style={{
            margin: '0 0 16px',
            color: colors.body,
            fontSize,
            lineHeight: `${lineHeight}px`,
            textAlign: align,
          }}
        >
          {paragraph.split('\n').map((line, lineIndex, lines) => (
            <span key={lineIndex}>
              {line}
              {lineIndex < lines.length - 1 ? <br /> : null}
            </span>
          ))}
        </Text>
      ))}
  </>
)

export const EmailButton = ({
  label,
  url,
  background,
  backgroundClass,
  textColor,
  textClass,
  align = 'left',
  large = false,
}: {
  label: string
  url: string
  background: string
  backgroundClass: string
  textColor: string
  textClass: string
  align?: Align
  large?: boolean
}) => (
  <table
    role="presentation"
    cellPadding={0}
    cellSpacing={0}
    border={0}
    align={align}
    style={{ margin: align === 'center' ? '0 auto' : '8px 0 16px' }}
  >
    <tbody>
      <tr>
        <td
          align="center"
          {...bgcolor(background)}
          className={backgroundClass}
          style={{ backgroundColor: background, borderRadius: 6 }}
        >
          <Link
            href={url}
            className={textClass}
            style={{
              display: 'inline-block',
              padding: large ? '18px 40px' : '12px 24px',
              color: textColor,
              fontSize: large ? 19 : 15,
              fontWeight: 700,
              lineHeight: '22px',
              textDecoration: 'none',
            }}
          >
            {label}
          </Link>
        </td>
      </tr>
    </tbody>
  </table>
)

export const EmailTextLink = ({
  colors,
  label,
  url,
}: {
  colors: EmailThemeColors
  label: string
  url: string
}) => (
  <Text
    className="em-body"
    style={{
      margin: '0 0 16px',
      color: colors.body,
      fontSize: 16,
      lineHeight: '26px',
    }}
  >
    <Link
      href={url}
      className="em-cta-link"
      style={{ color: colors.cta, textDecoration: 'underline' }}
    >
      {label}
    </Link>
  </Text>
)

export const EmailDivider = ({ colors }: { colors: EmailThemeColors }) => (
  <table
    role="presentation"
    width="100%"
    cellPadding={0}
    cellSpacing={0}
    border={0}
    style={{ width: '100%', margin: '12px 0 20px' }}
  >
    <tbody>
      <tr>
        <td
          {...bgcolor(colors.divider)}
          className="em-divider"
          height={1}
          style={{
            backgroundColor: colors.divider,
            height: 1,
            lineHeight: '1px',
            fontSize: 1,
          }}
        >
          &nbsp;
        </td>
      </tr>
    </tbody>
  </table>
)

export const EmailBodyBlock = ({
  colors,
  children,
  align = 'left',
  padding = '32px 32px 16px',
}: {
  colors: EmailThemeColors
  children: ReactNode
  align?: Align
  padding?: string
}) => (
  <Block
    background={colors.card}
    className="em-card"
    align={align}
    padding={padding}
  >
    {children}
  </Block>
)

export const EmailFooter = ({
  colors,
  context,
  align = 'left',
}: {
  colors: EmailThemeColors
  context: EmailTemplateContext
  align?: Align
}) => {
  const textStyle = {
    margin: '0 0 8px',
    color: colors.meta,
    fontSize: 13,
    lineHeight: '20px',
    textAlign: align,
  }
  return (
    <>
      <Block background={colors.divider} className="em-divider" height={1} />
      <Block
        background={colors.card}
        className="em-card"
        align={align}
        padding="24px 32px 32px"
      >
        {context.paidForBy ? (
          <Text className="em-meta" style={textStyle}>
            {`Paid for by ${context.paidForBy}`}
          </Text>
        ) : null}
        <Text className="em-meta" style={textStyle}>
          {`You’re getting this email because you asked to hear from ${context.senderName}.`}
        </Text>
        <Text className="em-meta" style={textStyle}>
          {EMAIL_POSTAL_ADDRESS}
        </Text>
        <Text className="em-meta" style={{ ...textStyle, margin: 0 }}>
          <Link
            href={emailVariableToken(EMAIL_VARIABLES.unsubscribeUrl)}
            className="em-meta"
            style={{ color: colors.meta, textDecoration: 'underline' }}
          >
            Unsubscribe
          </Link>
        </Text>
      </Block>
    </>
  )
}
