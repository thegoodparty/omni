import { randomInt, randomUUID } from 'node:crypto'

// Dev's database and Clerk instance are long-lived and shared by every worker,
// every shard, every PR's run, every earlier run and the humans testing there,
// so a literal identifier in a test collides with all of them. Generate
// identifiers here instead.

export type GeneratedTestUserData = {
  firstName: string
  lastName: string
  email: string
  phone: string
  password: string
  zipCode: string
}

/**
 * Generate test user data (does NOT create actual user).
 */
export const generateTestUserData = (): GeneratedTestUserData => {
  const timestamp = `${Date.now()}-${randomUUID().slice(0, 5)}`
  return {
    firstName: `Test${timestamp}`,
    lastName: 'User',
    // `+clerk_test` makes Clerk's dev instance treat the address as a test
    // address: it sends no email (sign-in/verification code is 424242), so
    // these throwaway users cannot bounce (ENG-11573). The domain suffix is
    // kept so gp-api's isTestUser and sweepTestUsers still match.
    email: `test-${timestamp}+clerk_test@test.goodparty.org`,
    phone: `5105${Date.now().toString().slice(-6)}`,
    password: randomUUID(),
    zipCode: '82001',
  }
}

// Real area codes, so a validator that checks the area code accepts the number.
const AREA_CODES = [
  '201 202 206 212 213 214 215 303 305 307 312 313 314 317',
  '404 407 412 415 503 504 512 513 515 602 612 614 615 617',
  '702 704 713 718 720 801 804 808 813 816 901 916 919 971',
]
  .join(' ')
  .split(' ')

const issuedPhones = new Set<string>()

const randomAreaCode = (): string => AREA_CODES[randomInt(AREA_CODES.length)]!

/**
 * A 10-digit US phone number in the 555-0100 to 555-0199 block, which NANP
 * reserves for fiction in every area code, so it can never reach a real
 * person. That block is small (about 4,000 numbers here): a number is unique
 * within a process and unlikely to repeat across processes, but never use one
 * as the key that finds a record on dev.
 */
export const uniquePhone = (): string => {
  for (;;) {
    const phone = `${randomAreaCode()}55501${String(randomInt(100)).padStart(2, '0')}`
    if (!issuedPhones.has(phone)) {
      issuedPhones.add(phone)
      return phone
    }
  }
}
