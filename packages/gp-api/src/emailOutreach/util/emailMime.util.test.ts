import { describe, expect, it } from 'vitest'
import {
  decodeEncodedWords,
  parseAddresses,
  parseMime,
  readHeader,
  stripQuotedReply,
} from './emailMime.util'

const mime = (lines: string[]) => Buffer.from(lines.join('\r\n'), 'binary')

describe('parseMime', () => {
  it('reads headers, unfolding wrapped lines', () => {
    const parsed = parseMime(
      mime(['Subject: a very', ' long subject', 'From: a@b.co', '', 'hi']),
    )
    expect(readHeader(parsed.headers, 'subject')).toBe('a very long subject')
    expect(parsed.text).toBe('hi')
  })

  it('takes the plain part of a multipart body and skips attachments', () => {
    const parsed = parseMime(
      mime([
        'Content-Type: multipart/mixed; boundary="B"',
        '',
        '--B',
        'Content-Type: multipart/alternative; boundary="A"',
        '',
        '--A',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Plain words',
        '--A',
        'Content-Type: text/html',
        '',
        '<p>Html words</p>',
        '--A--',
        '--B',
        'Content-Type: text/plain',
        'Content-Disposition: attachment; filename=a.txt',
        '',
        'attached',
        '--B--',
      ]),
    )
    expect(parsed.text).toBe('Plain words')
  })

  it('falls back to html with the tags removed', () => {
    const parsed = parseMime(
      mime(['Content-Type: text/html', '', '<p>Hello<br>there &amp; you</p>']),
    )
    expect(parsed.text).toBe('Hello\nthere & you')
  })

  it('decodes quoted-printable and base64 bodies', () => {
    expect(
      parseMime(
        mime([
          'Content-Type: text/plain; charset=utf-8',
          'Content-Transfer-Encoding: quoted-printable',
          '',
          'caf=C3=A9 =',
          'au lait',
        ]),
      ).text,
    ).toBe('café au lait')
    expect(
      parseMime(
        mime([
          'Content-Transfer-Encoding: base64',
          '',
          Buffer.from('stop').toString('base64'),
        ]),
      ).text,
    ).toBe('stop')
  })

  it('stops at a multipart that nests too deeply', () => {
    let body = 'text'
    for (let i = 0; i < 10; i++) {
      body = `Content-Type: multipart/mixed; boundary="b${i}"\r\n\r\n--b${i}\r\n${body}\r\n--b${i}--`
    }
    expect(parseMime(mime([body])).text).toBe('')
  })
})

describe('headers and addresses', () => {
  it('decodes encoded words', () => {
    expect(decodeEncodedWords('=?UTF-8?B?Q2Fmw6k=?=')).toBe('Café')
    expect(decodeEncodedWords('=?UTF-8?Q?Caf=C3=A9_au_lait?=')).toBe(
      'Café au lait',
    )
  })

  it('parses named and bare addresses', () => {
    expect(parseAddresses('"Pat Voter" <Pat@Example.com>, b@c.org')).toEqual([
      { address: 'pat@example.com', name: 'Pat Voter' },
      { address: 'b@c.org', name: null },
    ])
    expect(parseAddresses('x@y.com')).toEqual([
      { address: 'x@y.com', name: null },
    ])
    expect(parseAddresses(undefined)).toEqual([])
  })
})

describe('stripQuotedReply', () => {
  it('keeps what the sender wrote', () => {
    expect(
      stripQuotedReply(
        'Stop\n\nOn Tue, Oct 27, Jane wrote:\n> Join us\n> at 7',
      ),
    ).toBe('Stop')
    expect(stripQuotedReply('> only quoted')).toBe('')
  })
})
