import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import type { PriorityReadStatus } from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { ReadStatusRailBlock, ReadStatusStrip } from './ReadStatus'

const READ: PriorityReadStatus = {
  answers: 12,
  needed: 40,
  groupsHeard: 9,
  groupsTotal: 12,
  representativeAnswers: 10,
  representativeNeeded: 40,
  good: false,
  status: 'notYetRepresentative',
  underrepresented: ['age65plus'],
  checkOut: true,
}

const renderBlock = (readStatus: PriorityReadStatus) =>
  render(
    <ReadStatusRailBlock
      priorityId="pri-1"
      readStatus={readStatus}
      onGetAnswers={vi.fn()}
    />,
  )

describe('ReadStatusRailBlock', () => {
  it('says when a paid follow-up text goes out', () => {
    renderBlock({
      ...READ,
      followUp: { scheduledLocalDate: '2026-11-03', texts: 300 },
    })
    expect(
      screen.getByText('Follow-up text to 300 people on Nov 3'),
    ).toBeInTheDocument()
  })

  it('says it on a good read too', () => {
    renderBlock({
      ...READ,
      good: true,
      status: 'representative',
      underrepresented: [],
      followUp: { scheduledLocalDate: '2026-11-03', texts: 300 },
    })
    expect(
      screen.getByText(/^Follow-up text to 300 people/),
    ).toBeInTheDocument()
  })

  it('says nothing about a follow-up when there is none', () => {
    renderBlock(READ)
    expect(screen.queryByText(/Follow-up text/)).not.toBeInTheDocument()
  })
})

describe('the rail seats', () => {
  it('draws the answers that count as seats, with a key and the groups named', () => {
    renderBlock({ ...READ, groupsNext: 1 })
    const arc = screen.getByRole('img', {
      name: '10 of the 40 answers we need',
    })
    expect(arc.querySelectorAll('circle')).toHaveLength(100)
    expect(arc.querySelectorAll('[data-state="heard"]')).toHaveLength(25)
    expect(arc.querySelectorAll('[data-state="needed"]')).toHaveLength(75)
    expect(screen.getByText('10 of the 40 answers we need')).toBeInTheDocument()
    expect(screen.queryByText(/groups heard/)).not.toBeInTheDocument()
    expect(screen.getByText('Heard')).toBeInTheDocument()
    expect(screen.getByText('Still needed')).toBeInTheDocument()
    expect(
      screen.getByText('Need a few more answers from people 65 and over'),
    ).toBeInTheDocument()
  })

  // jsdom applies no CSS, so this pins the classes that pick one by width.
  it('shows the seats from lg up and the bar below it', () => {
    renderBlock(READ)
    const arc = screen.getByRole('img', {
      name: '10 of the 40 answers we need',
    })
    expect(arc).toHaveClass('hidden', 'lg:block')
    expect(screen.getByText('Heard').closest('ul')).toHaveClass(
      'hidden',
      'lg:flex',
    )
    const bar = screen.getByRole('progressbar', {
      name: '10 of the 40 answers we need',
    })
    expect(bar).toHaveClass('lg:hidden')
    expect(bar).not.toHaveClass('hidden')
  })

  it('keeps a good read as it is, with no seats', () => {
    renderBlock({
      ...READ,
      good: true,
      status: 'representative',
      groupsHeard: 12,
      underrepresented: [],
    })
    expect(screen.getByText('Every group heard')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})

describe('Get answers', () => {
  const rail = (readStatus: PriorityReadStatus) => renderBlock(readStatus)
  const button = () => screen.queryByRole('button', { name: 'Get answers' })

  it('shows once a check is out and the read is short', () => {
    rail(READ)
    expect(button()).toBeInTheDocument()
  })

  it('says no one asked yet, with no button, before a check is out', () => {
    rail({ ...READ, checkOut: undefined, groupsHeard: 0 })
    expect(screen.getByText('No one asked yet')).toBeInTheDocument()
    expect(button()).not.toBeInTheDocument()
    expect(screen.queryByText(/answers we need/)).not.toBeInTheDocument()
  })

  it('gives way to the follow-up text while it is scheduled', () => {
    rail({
      ...READ,
      followUp: { scheduledLocalDate: '2026-11-03', texts: 300 },
    })
    expect(button()).not.toBeInTheDocument()
    expect(
      screen.getByText('Follow-up text to 300 people on Nov 3'),
    ).toBeInTheDocument()
  })

  it('does not show once the follow-up text has gone out', () => {
    rail({ ...READ, followUpSent: true })
    expect(button()).not.toBeInTheDocument()
  })

  it('does not show on a good read', () => {
    rail({ ...READ, good: true, status: 'representative' })
    expect(button()).not.toBeInTheDocument()
  })

  it('says it on the phone strip too', () => {
    render(
      <ReadStatusStrip
        priorityId="pri-1"
        readStatus={{ ...READ, checkOut: undefined }}
        onGetAnswers={vi.fn()}
      />,
    )
    expect(screen.getByText('No one asked yet')).toBeInTheDocument()
    expect(button()).not.toBeInTheDocument()
  })
})

describe('ReadStatusStrip', () => {
  it('says when a paid follow-up text goes out, under the row', () => {
    render(
      <ReadStatusStrip
        priorityId="pri-1"
        readStatus={{
          ...READ,
          followUp: { scheduledLocalDate: '2026-11-03', texts: 300 },
        }}
        onGetAnswers={vi.fn()}
      />,
    )
    expect(
      screen.getByText(/^Follow-up text to 300 people/),
    ).toBeInTheDocument()
  })
})

// At 375px a line naming two groups is wider than the row, so it wraps to
// two lines instead of cutting off the groups, and Get answers moves to the
// row below. jsdom has no layout, so this pins the classes that do it.
describe('ReadStatusStrip on a phone', () => {
  const strip = (readStatus: PriorityReadStatus) =>
    render(
      <ReadStatusStrip
        priorityId="pri-1"
        readStatus={readStatus}
        onGetAnswers={vi.fn()}
      />,
    )

  it('wraps a short read to two lines, with Get answers below it', () => {
    strip({ ...READ, underrepresented: ['age65plus', 'age55to64'] })
    const line = screen.getByTestId('read-status-line')
    expect(line).toHaveTextContent(
      'Need a few more answers from people 65 and over and people 55 to 64',
    )
    expect(line).toHaveClass('line-clamp-2')
    expect(line).not.toHaveClass('truncate')
    const link = screen.getByRole('link', { name: /Need a few more answers/ })
    const button = screen.getByRole('button', { name: 'Get answers' })
    expect(link).not.toContainElement(button)
    expect(button).toBeEnabled()
    expect(
      screen.getByRole('progressbar', { name: '10 of the 40 answers we need' }),
    ).toBeInTheDocument()
  })

  it('wraps a good read too, beside See what we heard', () => {
    strip({
      ...READ,
      good: true,
      status: 'representative',
      underrepresented: [],
    })
    const line = screen.getByTestId('read-status-line')
    expect(line).toHaveTextContent("You've heard from every group")
    expect(line).toHaveClass('line-clamp-2')
    expect(line).not.toHaveClass('truncate')
    expect(
      screen.getByRole('link', { name: 'See what we heard' }),
    ).toBeInTheDocument()
  })
})
