import { describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { useEffect } from 'react'
import ChiefOfStaffChatSurface from './ChiefOfStaffChatSurface'

// Each mount pushes its conversation-shaping props, so a remount is visible as
// a new entry rather than an updated one.
const mounts: Array<{
  conversationIdOverride?: string
  pendingKickoff?: string
}> = []
function BodyStub(props: {
  conversationIdOverride?: string
  pendingKickoff?: string
}): null {
  useEffect(() => {
    mounts.push({
      conversationIdOverride: props.conversationIdOverride,
      pendingKickoff: props.pendingKickoff,
    })
    // Mount-only on purpose: this records remounts, not prop updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}
vi.mock('./ChiefOfStaffChatBody', () => ({ default: BodyStub }))

describe('ChiefOfStaffChatSurface body identity', () => {
  // A caller can swap one kickoff for another while the surface is already
  // open (the campaign manager's story and ballot home cards). Without a
  // remount the body keeps the conversation the first kickoff created and
  // appends the second kickoff's turn to it.
  it('remounts the body when the kickoff changes on an open surface', () => {
    mounts.length = 0
    const { rerender } = render(
      <ChiefOfStaffChatSurface
        open
        onOpenChange={vi.fn()}
        pendingKickoff="first-kickoff"
      />,
    )
    rerender(
      <ChiefOfStaffChatSurface
        open
        onOpenChange={vi.fn()}
        pendingKickoff="second-kickoff"
      />,
    )

    expect(mounts.map((m) => m.pendingKickoff)).toEqual([
      'first-kickoff',
      'second-kickoff',
    ])
  })

  it('keeps one body while the kickoff is unchanged', () => {
    mounts.length = 0
    const { rerender } = render(
      <ChiefOfStaffChatSurface
        open
        onOpenChange={vi.fn()}
        pendingKickoff="same-kickoff"
      />,
    )
    rerender(
      <ChiefOfStaffChatSurface
        open
        onOpenChange={vi.fn()}
        pendingKickoff="same-kickoff"
        subtitle="unrelated change"
      />,
    )

    expect(mounts).toHaveLength(1)
  })
})
