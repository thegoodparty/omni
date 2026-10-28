import { EMAIL_VARIABLES, emailVariableToken } from './emailTemplate.const'

const VARIABLE_OPEN = '\uE000'
const VARIABLE_CLOSE = '\uE001'
const BRACE_OPEN = '\uE002'
const BRACE_CLOSE = '\uE003'
const BACKSLASH_GUARD = '\uE004'
const ZERO_WIDTH_SPACE = '\u200B'

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
// Handlebars, so a `{{` typed by a user would otherwise become a variable, and
// a backslash before a brace would escape one, so it is followed by a
// zero-width space.
export const protectUserText = (text: string): string =>
  text
    .replace(/\\(?=\{)/g, `\\${BACKSLASH_GUARD}`)
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
    .replaceAll(BACKSLASH_GUARD, ZERO_WIDTH_SPACE)

export const restorePlainText = (text: string): string =>
  restoreVariables(text)
    .replaceAll(BRACE_OPEN, `{${ZERO_WIDTH_SPACE}`)
    .replaceAll(BRACE_CLOSE, `}${ZERO_WIDTH_SPACE}`)
    .replaceAll(BACKSLASH_GUARD, ZERO_WIDTH_SPACE)
