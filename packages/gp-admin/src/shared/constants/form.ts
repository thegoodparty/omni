/** @see https://react-hook-form.com/docs/useform#mode */
export const FORM_MODE = {
  ON_CHANGE: 'onChange',
  ON_BLUR: 'onBlur',
  ON_SUBMIT: 'onSubmit',
  ON_TOUCHED: 'onTouched',
  ALL: 'all',
} as const

export type FormMode = (typeof FORM_MODE)[keyof typeof FORM_MODE]

export const INPUT_TYPE = {
  TEXT: 'text',
  EMAIL: 'email',
  NUMBER: 'number',
  DATE: 'date',
  URL: 'url',
  TEL: 'tel',
  PASSWORD: 'password',
} as const

export type InputType = (typeof INPUT_TYPE)[keyof typeof INPUT_TYPE]
