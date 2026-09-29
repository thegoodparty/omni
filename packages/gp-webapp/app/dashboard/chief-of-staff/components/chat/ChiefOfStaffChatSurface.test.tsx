import { describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

describe('ChiefOfStaffChatSurface New chat', () => {
  it('renders no New chat action unless the owner passes onNewChat', () => {
    render(<ChiefOfStaffChatSurface open onOpenChange={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'New chat' })).toBeNull()
  })

  it('drops the active conversation and notifies the owner', async () => {
    mounts.length = 0
    const onNewChat = vi.fn()
    const user = userEvent.setup()
    render(
      <ChiefOfStaffChatSurface
        open
        onOpenChange={vi.fn()}
        initialConversationId="conv-9"
        onNewChat={onNewChat}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'New chat' }))

    expect(onNewChat).toHaveBeenCalledTimes(1)
    expect(mounts.map((m) => m.conversationIdOverride)).toEqual([
      'conv-9',
      undefined,
    ])
  })

  // The body can deferred-create a conversation the surface never sees in
  // selectedId — clearing selectedId alone would leave the key unchanged and
  // strand the candidate in that conversation.
  it('remounts the body even when no conversation was ever selected', async () => {
    mounts.length = 0
    const user = userEvent.setup()
    render(
      <ChiefOfStaffChatSurface
        open
        onOpenChange={vi.fn()}
        onNewChat={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'New chat' }))

    expect(mounts).toHaveLength(2)
  })
})
