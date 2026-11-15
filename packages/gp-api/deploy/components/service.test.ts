import { describe, expect, it } from 'vitest'
import { executionRoleSecretArns } from './service'

const devSecret =
  'arn:aws:secretsmanager:us-west-2:333022194791:secret:GP_API_DEV-ag7Mf4'

// A secret the execution role cannot read stops every new task before the
// app boots, so this grant has to cover each `valueFrom` the task definition
// names and nothing wider.
describe('the execution role secret grant', () => {
  it('collapses every key of one secret into a single grant', () => {
    expect(
      executionRoleSecretArns([
        `${devSecret}:DB_PASSWORD::`,
        `${devSecret}:CLERK_SECRET_KEY::`,
      ]),
    ).toEqual([
      'arn:aws:secretsmanager:us-west-2:333022194791:secret:GP_API_DEV-??????',
    ])
  })

  it('grants each secret a task definition draws from', () => {
    expect(
      executionRoleSecretArns([
        `${devSecret}:DB_PASSWORD::`,
        'arn:aws:secretsmanager:us-west-2:333022194791:secret:OTHER-xY12zQ',
      ]),
    ).toEqual([
      'arn:aws:secretsmanager:us-west-2:333022194791:secret:GP_API_DEV-??????',
      'arn:aws:secretsmanager:us-west-2:333022194791:secret:OTHER-??????',
    ])
  })

  it('keeps hyphens that belong to the secret name', () => {
    expect(
      executionRoleSecretArns([
        'arn:aws:secretsmanager:us-west-2:333022194791:secret:gp-api-x-AbC123',
      ]),
    ).toEqual([
      'arn:aws:secretsmanager:us-west-2:333022194791:secret:gp-api-x-??????',
    ])
  })

  it('refuses a source it cannot scope', () => {
    expect(() =>
      executionRoleSecretArns(['/gp-api/dev/SOME_PARAMETER']),
    ).toThrow(/not a full Secrets Manager ARN/)
    expect(() =>
      executionRoleSecretArns([
        'arn:aws:ssm:us-west-2:333022194791:parameter/gp-api/KEY',
      ]),
    ).toThrow(/not a full Secrets Manager ARN/)
  })
})
