import { randomInt } from 'crypto'

// Dev's database and Clerk instance are long-lived and shared by every worker,
// every shard, every PR's run, every earlier run and the humans testing there,
// so a literal identifier in a spec collides with all of them. Two parallel
// 10DLC registrations sharing one EIN let one test's campaign claim the other's
// identity (#3117). Generate identifiers here instead.

const RUN = process.env.GITHUB_RUN_ID
  ? `${Number(process.env.GITHUB_RUN_ID).toString(36)}${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`
  : 'local'

// Playwright sets TEST_WORKER_INDEX in each worker process.
const WORKER = process.env.TEST_WORKER_INDEX ?? '0'

// Shards of one run share the run id and reuse the same worker indexes, and a
// worker is never told which shard it is in, so this salt keeps them apart.
const SALT = randomInt(36 ** 4)
  .toString(36)
  .padStart(4, '0')

let sequence = 0

/**
 * A lowercase alphanumeric token no other call, worker, shard or run returns:
 * run id and attempt, worker index, a per-process salt and a counter.
 */
export const uniqueToken = (): string => {
  sequence += 1
  return `${RUN}w${WORKER}${SALT}${sequence.toString(36)}`
}

export const uniqueOrgName = (prefix = 'E2E Org'): string =>
  `${prefix} ${uniqueToken()}`

export const uniqueDomain = (tld = 'com'): string =>
  `e2e-${uniqueToken()}.${tld}`

const issued = new Set<string>()

const unseen = (
  generate: () => string,
  reject: (value: string) => boolean = () => false,
): string => {
  for (;;) {
    const value = generate()
    if (!issued.has(value) && !reject(value)) {
      issued.add(value)
      return value
    }
  }
}

const pick = <T>(values: readonly T[]): T => values[randomInt(values.length)]!

// Two contiguous runs of the prefixes the IRS issues (VALID_EIN_PREFIXES in
// app/shared/inputs/EinSanityCheck.ts), so the wizard's sanity check passes.
const EIN_PREFIXES = [
  ...Array.from({ length: 19 }, (_, i) => 30 + i),
  ...Array.from({ length: 19 }, (_, i) => 50 + i),
].map(String)

/** An `NN-NNNNNNN` EIN with a valid IRS prefix, from 380 million. */
export const uniqueEin = (): string =>
  unseen(
    () =>
      `${pick(EIN_PREFIXES)}-${String(randomInt(10_000_000)).padStart(7, '0')}`,
    // An all-same-digit EIN fails the wizard's placeholder check.
    (ein) => /^(\d)\1-\1{7}$/.test(ein),
  )

// Real area codes, so a validator that checks the area code accepts the number.
const AREA_CODES = [
  '201 202 206 212 213 214 215 303 305 307 312 313 314 317',
  '404 407 412 415 503 504 512 513 515 602 612 614 615 617',
  '702 704 713 718 720 801 804 808 813 816 901 916 919 971',
]
  .join(' ')
  .split(' ')

/**
 * A 10-digit US phone number in the 555-0100 to 555-0199 block, which NANP
 * reserves for fiction in every area code, so it can never reach a real
 * person. That block is small (about 4,000 numbers here): a number is unique
 * within a worker and unlikely to repeat across workers, but never use one as
 * the key that finds a record on dev.
 */
export const uniquePhone = (): string =>
  unseen(
    () => `${pick(AREA_CODES)}55501${String(randomInt(100)).padStart(2, '0')}`,
  )
