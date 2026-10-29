import { BadRequestException } from '@nestjs/common'
import csvParser from 'csv-parser'
import { Readable } from 'stream'
import { EMAIL_UPLOAD_MAX_ROWS } from '@goodparty_org/contracts'

export type RawRecipientRow = {
  email: string
  firstName: string
  lastName: string
}

const FIRST_NAME_HEADERS = ['first_name', 'first name', 'firstname', 'first']
const LAST_NAME_HEADERS = ['last_name', 'last name', 'lastname', 'last']

const normalizeHeader = (header: string): string =>
  header.replace(/^﻿/, '').trim().toLowerCase()

export const parseRecipientCsv = async (
  file: Buffer | Readable,
): Promise<RawRecipientRow[]> => {
  const rows: RawRecipientRow[] = []
  let headers: string[] = []
  const source = Buffer.isBuffer(file) ? Readable.from(file) : file
  const stream = source.pipe(
    csvParser({
      mapHeaders: ({ header }) => normalizeHeader(header),
      mapValues: ({ value }: { value: string }) => value.trim(),
    }),
  )
  stream.on('headers', (parsed: string[]) => {
    headers = parsed
  })

  try {
    const records: AsyncIterable<Record<string, string>> = stream
    for await (const record of records) {
      if (rows.length >= EMAIL_UPLOAD_MAX_ROWS) {
        throw new BadRequestException(
          `The file has more than ${EMAIL_UPLOAD_MAX_ROWS} rows`,
        )
      }
      const pick = (names: string[]): string =>
        record[names.find((name) => headers.includes(name)) ?? ''] ?? ''
      rows.push({
        email: record.email ?? '',
        firstName: pick(FIRST_NAME_HEADERS),
        lastName: pick(LAST_NAME_HEADERS),
      })
    }
  } finally {
    stream.destroy()
  }

  if (!headers.includes('email')) {
    throw new BadRequestException('The file needs an "email" column')
  }
  return rows
}
