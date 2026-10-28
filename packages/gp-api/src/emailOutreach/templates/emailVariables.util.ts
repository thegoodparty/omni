import { EMAIL_VARIABLES, emailVariableToken } from './emailTemplate.const'

const VARIABLE_OPEN = ''
const VARIABLE_CLOSE = ''
const BRACE_OPEN = ''
const BRACE_CLOSE = ''
const ZERO_WIDTH_SPACE = '​'

const USER_VARIABLES = [EMAIL_VARIABLES.firstName, EMAIL_VARIABLES.lastName]

const USER_VARIABLE_PATTERN = new RegExp(
  USER_VARIABLES.map((name) =>
    emailVariableToken(name).replace(/[{}]/g, '\\$&'),
  ).join('|'),
  'g',
)

const sentinel = (name: string): string =>
  `${VARIABLE_OPEN}${name}${VARIABLE_CLOSE}`

// Turns user-typed text into a string that survives React's escaping with the
// two merge tags marked and every other brace neutralized. SES templates are
// Handlebars, so a `{{` typed by a user would otherwise become a variable.
export const protectUserText = (text: string): string =>
  text
    .replace(USER_VARIABLE_PATTERN, (match) => sentinel(match.slice(2, -2)))
    .replace(/\{/g, BRACE_OPEN)
    .replace(/\}/g, BRACE_CLOSE)

// Braces in a URL would be read as variables, so they are percent-encoded.
export const protectUrl = (value: string): string =>
  new URL(value).toString().replace(/\{/g, '%7B').replace(/\}/g, '%7D')

const restoreVariables = (value: string): string =>
  USER_VARIABLES.reduce(
    (result, name) =>
      result.replaceAll(sentinel(name), emailVariableToken(name)),
    value,
  )

export const restoreHtml = (html: string): string =>
  restoreVariables(html)
    .replaceAll(BRACE_OPEN, '&#123;')
    .replaceAll(BRACE_CLOSE, '&#125;')

export const restorePlainText = (text: string): string =>
  restoreVariables(text)
    .replaceAll(BRACE_OPEN, `{${ZERO_WIDTH_SPACE}`)
    .replaceAll(BRACE_CLOSE, `}${ZERO_WIDTH_SPACE}`)
