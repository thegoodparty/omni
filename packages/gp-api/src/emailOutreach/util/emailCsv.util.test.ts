import { BadRequestException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { parseRecipientCsv } from './emailCsv.util'

const csv = (text: string) => Buffer.from(text, 'utf8')

describe('parseRecipientCsv', () => {
  it('finds headers in any case and reads optional names', async () => {
    const rows = await parseRecipientCsv(
      csv('EMAIL, First Name ,LAST\na@x.com,Ann,Lee\n'),
    )
    expect(rows).toEqual([
      { email: 'a@x.com', firstName: 'Ann', lastName: 'Lee' },
    ])
  })

  it('refuses a file with no email column', async () => {
    await expect(parseRecipientCsv(csv('name\nAnn\n'))).rejects.toThrow(
      BadRequestException,
    )
  })

  it('strips a byte order mark from the first header', async () => {
    const rows = await parseRecipientCsv(csv('﻿email\na@x.com\n'))
    expect(rows.map((r) => r.email)).toEqual(['a@x.com'])
  })

  it('keeps commas inside quoted values', async () => {
    const rows = await parseRecipientCsv(
      csv('email,first_name\na@x.com,"Lee, Ann"\n'),
    )
    expect(rows[0]?.firstName).toBe('Lee, Ann')
  })

  it('accepts exactly 5,000 rows and refuses 5,001', async () => {
    const body = (n: number) =>
      'email\n' + Array.from({ length: n }, (_, i) => `u${i}@x.com`).join('\n')
    expect(await parseRecipientCsv(csv(body(5000)))).toHaveLength(5000)
    await expect(parseRecipientCsv(csv(body(5001)))).rejects.toThrow(
      BadRequestException,
    )
  })
})
