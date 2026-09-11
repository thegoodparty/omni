import { describe, expect, it } from 'vitest'
import { chunkTurn } from './chunkTurn'

describe('chunkTurn', () => {
  it('splits a week-ahead rundown at its section labels', () => {
    // The shape the agent actually produced before this existed: one turn,
    // four sections, delivered as a wall.
    const turn = [
      "Good to have you here, Bryan. Here's your situation heading into the week:",
      '',
      '**Meetings & Briefings**',
      'No upcoming meeting briefings are queued up right now.',
      '',
      '**Your Standing Priority**',
      'School Funding is your one active priority.',
      '',
      '**My Recommendations**',
      'Dig into constituent sentiment on school funding.',
    ].join('\n')

    const chunks = chunkTurn(turn)

    expect(chunks).toHaveLength(4)
    expect(chunks[0]).toContain('Good to have you here')
    expect(chunks[1]).toContain('Meetings & Briefings')
    expect(chunks[2]).toContain('Your Standing Priority')
    expect(chunks[3]).toContain('My Recommendations')
  })

  it('splits on markdown headings too', () => {
    const chunks = chunkTurn('Lead in.\n\n## First\nbody\n\n## Second\nbody')
    expect(chunks).toHaveLength(3)
  })

  it('does not split on bold used mid-sentence', () => {
    // The agent bolds terms inside prose constantly. Splitting on those would
    // shatter a paragraph into fragments.
    const turn =
      'Your **School Funding** priority is active and the **budget vote** is close.'
    expect(chunkTurn(turn)).toEqual([turn])
  })

  it('does not emit an empty chunk when the turn opens with a label', () => {
    const chunks = chunkTurn('**Meetings**\nNothing queued.')
    expect(chunks).toEqual(['**Meetings**\nNothing queued.'])
  })

  it('leaves label-like lines inside a code fence alone', () => {
    const turn = [
      'Here is the snippet:',
      '',
      '```md',
      '**Not a section**',
      '## Nor this',
      '```',
      '',
      '**Actually a section**',
      'body',
    ].join('\n')

    const chunks = chunkTurn(turn)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toContain('**Not a section**')
    expect(chunks[1]).toContain('Actually a section')
  })

  it('renders a mid-stream unterminated fence whole', () => {
    // Mid-stream the closing fence has not arrived, so the scan cannot tell
    // code from prose. One bubble now, re-split on the next tick.
    const turn = 'Here:\n\n```md\n**Not a section**'
    expect(chunkTurn(turn)).toEqual([turn])
  })

  it('passes short single-line prose straight through', () => {
    expect(chunkTurn('Nothing urgent this week.')).toEqual([
      'Nothing urgent this week.',
    ])
  })
})
