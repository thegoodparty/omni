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
    expect(screen.queryByText(/groups heard/)).not.toBeInTheDocument()
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
