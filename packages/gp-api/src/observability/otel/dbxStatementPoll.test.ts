import { describe, expect, it } from 'vitest'
import { isDbxStatementPoll } from './dbxStatementPoll'

// This predicate suppresses spans. Matching too widely silently deletes the
// only trace evidence for a slow voter read, and the failure is invisible —
// nothing errors, the spans just stop existing. Hence the negative cases.
describe('isDbxStatementPoll', () => {
  it('matches the status poll awaitCompletion issues', () => {
    expect(
      isDbxStatementPoll('GET', '/api/2.0/sql/statements/01ef-abc-123'),
    ).toBe(true)
  })

  it('matches a poll carrying a query string', () => {
    expect(
      isDbxStatementPoll('GET', '/api/2.0/sql/statements/01ef-abc-123?x=1'),
    ).toBe(true)
  })

  it('does not match the submit, which carries the statement and its params', () => {
    expect(isDbxStatementPoll('POST', '/api/2.0/sql/statements')).toBe(false)
    expect(isDbxStatementPoll('GET', '/api/2.0/sql/statements')).toBe(false)
  })

  it('does not match chunk fetches, which move the payload', () => {
    expect(
      isDbxStatementPoll(
        'GET',
        '/api/2.0/sql/statements/01ef-abc-123/result/chunks/2',
      ),
    ).toBe(false)
  })

  it('does not match cancel', () => {
    expect(
      isDbxStatementPoll('POST', '/api/2.0/sql/statements/01ef-abc-123/cancel'),
    ).toBe(false)
  })

  it('does not match the OIDC token mint', () => {
    expect(isDbxStatementPoll('POST', '/oidc/v1/token')).toBe(false)
  })

  it('does not match unrelated vendor paths', () => {
    expect(isDbxStatementPoll('GET', '/v1/messages')).toBe(false)
  })
})
