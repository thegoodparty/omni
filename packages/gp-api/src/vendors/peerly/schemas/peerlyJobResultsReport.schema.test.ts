import { describe, expect, it } from 'vitest'
import {
  peerlyCdrCsvRowSchema,
  peerlyQuestionResponsesCsvRowSchema,
  PeerlyReportLinkResponseDto,
} from './peerlyJobResultsReport.schema'

// Fixtures captured from the dev Peerly account on 2026-07-17 (ENG-10727),
// job 9FFzaTFvt67QZpxzPp52. Phone numbers, ids, and the signed-URL signature
// are redacted; field names and value shapes are verbatim.
const cdrReportLinkResponse = {
  result: 'success',
  link: 'https://storage.googleapis.com/cdr-reports-v2/9FFzaTFvt67QZpxzPp52-Justin_Campaign-1784329204886290608.csv?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Signature=REDACTED',
}

const questionResponsesReportLinkResponse = {
  link: 'https://ivr-platform-reports.s3.amazonaws.com/9FFzaTFvt67QZpxzPp52-Justin_Campaign-1784329251.9360273.csv.zip?Expires=1786921252&Signature=REDACTED&AWSAccessKeyId=REDACTED',
  result: 'success',
}

const cdrCsvRow = {
  Timestamp: '2025-08-20 10:23:46',
  Direction: 'sent',
  Agent_id: 'G7E4ET6EbRYyYcTprQ72Lqs6pq23@11536770',
  Agent_name: 'GoodParty Engineering',
  Conversation_id: 'GV49agprAVscbWKKPZiC',
  From: '1625550000',
  To: '1325550000',
  Content: 'EARLY VOTING IS HERE, Justin! Reply STOP to opt-out.',
  Chunk: '1',
  Result: 'SUCCESS',
  Cost: '0.036',
  Canvasser_rate: '',
  Unicode: '0',
  MMS: '1',
  'Media Url': 'https://firebasestorage.googleapis.com/v0/b/REDACTED.png',
  Extern_id: '',
  Sublist_id: '1185550000',
  Title: '',
  First_name: 'Justin',
  Mid_name: '',
  Last_name: 'Hanson',
  Suffix: '',
  Address1: '',
  Address2: '',
  City: '',
  State: '',
  Zip: '',
  Email: '',
  Aux_data1: '',
  Aux_data2: '',
  Aux_data3: '',
  Aux_data4: '',
  Aux_data5: '',
}

// The dev account has no job with inbound traffic, so no questionresponses
// data row could be captured; this row is the captured header list with
// empty values, which is exactly what a CSV parser yields for a blank row.
const questionResponsesCsvRow = {
  date: '',
  conversation_id: '',
  agent_id: '',
  agent_name: '',
  agent_email: '',
  from_did: '',
  lead_phone: '',
  sublist_id: '',
  extern_id: '',
  first_name: '',
  mid_name: '',
  last_name: '',
  suffix: '',
  address1: '',
  address2: '',
  city: '',
  state: '',
  zip: '',
  email: '',
  aux_data1: '',
  aux_data2: '',
  aux_data3: '',
  aux_data4: '',
  aux_data5: '',
  optout: '',
}

describe('peerlyJobResultsReport schemas', () => {
  it('parses the captured cdrs report-link response', () => {
    const parsed = PeerlyReportLinkResponseDto.create(cdrReportLinkResponse)
    expect(parsed.link).toContain('cdr-reports-v2')
    expect(parsed.result).toBe('success')
  })

  it('parses the captured questionresponses report-link response', () => {
    const parsed = PeerlyReportLinkResponseDto.create(
      questionResponsesReportLinkResponse,
    )
    expect(parsed.link).toContain('.csv.zip')
  })

  it('parses a captured cdrs CSV row', () => {
    const parsed = peerlyCdrCsvRowSchema.parse(cdrCsvRow)
    expect(parsed.Direction).toBe('sent')
    expect(parsed.Conversation_id).toBe('GV49agprAVscbWKKPZiC')
    expect(parsed['Media Url']).toContain('https://')
  })

  it('parses a questionresponses CSV row and keeps the optout column', () => {
    const parsed = peerlyQuestionResponsesCsvRowSchema.parse(
      questionResponsesCsvRow,
    )
    expect(parsed).toHaveProperty('optout')
  })

  it('rejects a report response without a link', () => {
    expect(() =>
      PeerlyReportLinkResponseDto.create({ result: 'success' }),
    ).toThrow()
  })
})
