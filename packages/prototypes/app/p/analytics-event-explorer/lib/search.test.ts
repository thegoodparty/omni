import { describe, expect, it } from 'vitest'
import { search, type Results } from './search'

const events = (r: Results) => r.events.map((h) => h.item.display_name)
const questions = (r: Results) => r.questions.map((h) => h.item.id)

describe('search', () => {
  // Nate typed this verbatim and got an empty page, which on this page reads as
  // "we do not measure that" rather than "the box only matches literal substrings".
  it('finds an event when the query joins words the event splits', () => {
    expect(events(search('Phonebanking Contacts'))).toContain(
      'Outreach - Phone Banking: Call Logged',
    )
  })

  it('finds an event when the query splits words the event joins', () => {
    expect(events(search('click to call'))).toContain(
      'Click to Call CTA Clicked',
    )
  })

  it('tolerates a plural the data writes in the singular', () => {
    expect(events(search('phone banking contacts'))).toContain(
      'Outreach - Phone Banking: Contact Viewed',
    )
  })

  it('still ranks the question above the events that answer it', () => {
    const r = search('voter file export')
    expect(questions(r)[0]).toBe('voter_file_exported')
    expect(r.partial).toBe(false)
  })

  // The task the page was designed around, typed the way it was actually said.
  it('survives a whole sentence, where most words are grammar', () => {
    const r = search('how many candidates exported a voter file last week')
    expect(questions(r)[0]).toBe('voter_file_exported')
  })

  it('answers a half-matching query with its closest matches, not a blank page', () => {
    const r = search('phone banking unicorn')
    expect(r.total).toBeGreaterThan(0)
    expect(r.partial).toBe(true)
    expect(events(r)[0]).toContain('Phone Banking')
  })

  it('still finds nothing when there is genuinely nothing', () => {
    const r = search('zzzz qqqq')
    expect(r.total).toBe(0)
    expect(r.partial).toBe(false)
  })
})
