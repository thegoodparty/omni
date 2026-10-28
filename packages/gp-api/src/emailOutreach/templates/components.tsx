import {
  Body,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Text,
} from '@react-email/components'
import type { ReactNode } from 'react'
import type { EmailThemeColors } from '@goodparty_org/contracts'
import { EMAIL_POSTAL_ADDRESS, EMAIL_VARIABLES } from './emailTemplate.const'
import { emailVariableToken } from './emailTemplate.const'
import type { EmailTemplateContent } from './emailTemplate.types'

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

// bgcolor is a legacy attribute that email clients still honor and React's
// types omit.
const bgcolor = (color: string): { bgcolor: string } => ({ bgcolor: color })

export type LayoutProps = {
  colors: EmailThemeColors
  content: EmailTemplateContent
}

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
    ['em-accent', 'background-color', colors.accent],
    ['em-cta', 'background-color', colors.cta],
    ['em-header-text', 'color', colors.headerText],
    ['em-headline', 'color', colors.headline],
    ['em-body', 'color', colors.body],
    ['em-meta', 'color', colors.meta],
    ['em-cta-text', 'color', colors.ctaText],
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
  align?: 'left' | 'center'
  padding?: string
  height?: number
}

const Block = ({
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
          {children ?? (height ? ' ' : null)}
        </td>
      </tr>
    </tbody>
  </table>
)

export const EmailShell = ({
  colors,
  subject,
  children,
}: {
  colors: EmailThemeColors
  subject: string
  children: ReactNode
}) => (
  <Html lang="en">
    <Head>
      <meta name="color-scheme" content="light only" />
      <meta name="supported-color-schemes" content="light only" />
      <title>{subject}</title>
      <style>{darkModeCss(colors)}</style>
    </Head>
    <Body
      style={{
        margin: 0,
        padding: 0,
        backgroundColor: colors.bg,
        fontFamily: FONT_STACK,
      }}
      {...bgcolor(colors.bg)}
      className="em-bg"
    >
      <Block background={colors.bg} className="em-bg" padding="24px 12px">
        <table
          role="presentation"
          width="600"
          cellPadding={0}
          cellSpacing={0}
          border={0}
          {...bgcolor(colors.card)}
          className="em-card"
          style={{
            width: '100%',
            maxWidth: 600,
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

// A light header (cream_and_forest) needs the rule line to separate it from
// the card; for solid headers the rule is the header's own color and
// disappears.
export const EmailHeader = ({
  colors,
  senderName,
  align = 'left',
}: {
  colors: EmailThemeColors
  senderName: string
  align?: 'left' | 'center'
}) => (
  <>
    <Block
      background={colors.header}
      className="em-header"
      align={align}
      padding="20px 32px"
    >
      <Text
        className="em-header-text"
        style={{
          margin: 0,
          color: colors.headerText,
          fontSize: 18,
          fontWeight: 700,
          lineHeight: '24px',
        }}
      >
        {senderName}
      </Text>
    </Block>
    <Block background={colors.rule} className="em-rule" height={3} />
  </>
)

export const EmailImage = ({ url }: { url: string }) => (
  <Img
    src={url}
    alt=""
    width="600"
    style={{ display: 'block', width: '100%', maxWidth: 600, height: 'auto' }}
  />
)

export const EmailHeadline = ({
  colors,
  text,
  size = 28,
  align = 'left',
}: {
  colors: EmailThemeColors
  text: string
  size?: number
  align?: 'left' | 'center'
}) => (
  <Heading
    as="h1"
    className="em-headline"
    style={{
      margin: '0 0 16px',
      color: colors.headline,
      fontSize: size,
      lineHeight: `${size + 8}px`,
      fontWeight: 700,
      textAlign: align,
    }}
  >
    {text}
  </Heading>
)

export const EmailParagraphs = ({
  colors,
  text,
  align = 'left',
}: {
  colors: EmailThemeColors
  text: string
  align?: 'left' | 'center'
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
            fontSize: 16,
            lineHeight: '26px',
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
  colors,
  label,
  url,
  align = 'left',
  large = false,
}: {
  colors: EmailThemeColors
  label: string
  url: string
  align?: 'left' | 'center'
  large?: boolean
}) => (
  <table
    role="presentation"
    cellPadding={0}
    cellSpacing={0}
    border={0}
    align={align}
    style={{ margin: align === 'center' ? '8px auto 16px' : '8px 0 16px' }}
  >
    <tbody>
      <tr>
        <td
          align="center"
          {...bgcolor(colors.cta)}
          className="em-cta"
          style={{ backgroundColor: colors.cta, borderRadius: 6 }}
        >
          <Link
            href={url}
            className="em-cta-text"
            style={{
              display: 'inline-block',
              padding: large ? '18px 40px' : '14px 28px',
              color: colors.ctaText,
              fontSize: large ? 18 : 16,
              fontWeight: 700,
              lineHeight: '20px',
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

export const EmailBodyBlock = ({
  colors,
  children,
  align = 'left',
}: {
  colors: EmailThemeColors
  children: ReactNode
  align?: 'left' | 'center'
}) => (
  <Block
    background={colors.card}
    className="em-card"
    align={align}
    padding="32px 32px 16px"
  >
    {children}
  </Block>
)

export const EmailAccentBlock = ({
  colors,
  text,
  align = 'left',
}: {
  colors: EmailThemeColors
  text: string
  align?: 'left' | 'center'
}) => (
  <Block
    background={colors.accent}
    className="em-accent"
    align={align}
    padding="24px 32px"
  >
    <Heading
      as="h1"
      className="em-accent-text"
      style={{
        margin: 0,
        color: colors.accentText,
        fontSize: 26,
        lineHeight: '34px',
        fontWeight: 700,
        textAlign: align,
      }}
    >
      {text}
    </Heading>
  </Block>
)

export const EmailFooter = ({
  colors,
  footer,
}: {
  colors: EmailThemeColors
  footer: EmailTemplateContent['footer']
}) => {
  const textStyle = {
    margin: '0 0 8px',
    color: colors.meta,
    fontSize: 13,
    lineHeight: '20px',
  }
  return (
    <>
      <Block background={colors.divider} className="em-card" height={1} />
      <Block
        background={colors.card}
        className="em-card"
        padding="24px 32px 32px"
      >
        {footer.paidForBy ? (
          <Text className="em-meta" style={textStyle}>
            {`Paid for by ${footer.paidForBy}`}
          </Text>
        ) : null}
        <Text className="em-meta" style={textStyle}>
          {`You\u2019re getting this email because you asked to hear from ${footer.senderName}.`}
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
