import { z } from 'zod'
import {
  EMAIL_ADDRESS_MAX_LENGTH,
  EMAIL_NAME_MAX_LENGTH,
} from '../emailOutreach.const'

const EmailSchema = z.string().max(EMAIL_ADDRESS_MAX_LENGTH).email()

export const normalizeEmail = (raw: string): string | null => {
  const email = raw.trim().toLowerCase()
  return EmailSchema.safeParse(email).success ? email : null
}

export const capName = (raw: string): string | null =>
  raw.trim().slice(0, EMAIL_NAME_MAX_LENGTH) || null

export const emailDomain = (email: string): string =>
  email.slice(email.lastIndexOf('@') + 1)
