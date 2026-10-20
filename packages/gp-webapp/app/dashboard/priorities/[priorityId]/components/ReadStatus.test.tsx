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
      screen.getByText(
        "Follow-up text to 300 people on Nov 3, to the groups you've heard from least",
      ),
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
