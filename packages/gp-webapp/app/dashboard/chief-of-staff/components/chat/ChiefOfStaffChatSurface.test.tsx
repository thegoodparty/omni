import { describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import ChiefOfStaffChatSurface from './ChiefOfStaffChatSurface'

// Each mount pushes its conversation-shaping props, so a remount is visible as
// a new entry rather than an updated one.
const mounts: Array<{
  conversationIdOverride?: string
  pendingKickoff?: string
  pendingMessage?: string
  pendingFile?: File
}> = []
let lastSelectConversation: ((id: string) => void) | undefined
let lastConversationGone: ((conversationId: string) => void) | undefined
function BodyStub(props: {
  conversationIdOverride?: string
  pendingKickoff?: string
  pendingMessage?: string
  pendingFile?: File
  onSelectConversation?: (id: string) => void
  onConversationGone?: (conversationId: string) => void
}): null {
  lastSelectConversation = props.onSelectConversation
  lastConversationGone = props.onConversationGone
  useEffect(() => {
    mounts.push({
      conversationIdOverride: props.conversationIdOverride,
      pendingKickoff: props.pendingKickoff,
      pendingMessage: props.pendingMessage,
      pendingFile: props.pendingFile,
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
        analyticsSurface="chief_of_staff_page"
        onOpenChange={vi.fn()}
        pendingKickoff="first-kickoff"
      />,
    )
    rerender(
      <ChiefOfStaffChatSurface
        open
        analyticsSurface="chief_of_staff_page"
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
        analyticsSurface="chief_of_staff_page"
        onOpenChange={vi.fn()}
        pendingKickoff="same-kickoff"
      />,
    )
    rerender(
      <ChiefOfStaffChatSurface
        open
        analyticsSurface="chief_of_staff_page"
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
    render(
      <ChiefOfStaffChatSurface
        open
        analyticsSurface="chief_of_staff_page"
        onOpenChange={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'New chat' })).toBeNull()
  })

  it('drops the active conversation and notifies the owner', async () => {
    mounts.length = 0
    const onNewChat = vi.fn()
    const user = userEvent.setup()
    render(
      <ChiefOfStaffChatSurface
        open
        analyticsSurface="chief_of_staff_page"
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
        analyticsSurface="chief_of_staff_page"
        onOpenChange={vi.fn()}
        onNewChat={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'New chat' }))

    expect(mounts).toHaveLength(2)
  })

  // A pendingMessage is the caller's one-shot opening request for the chat it
  // opened. Picking a past conversation from the composer's history popover
  // remounts the body, which resets its sent-once latch — so if the prop
  // still reached it, that request would be delivered a second time into a
  // thread the viewer merely navigated to.
  it('withholds pendingMessage from a conversation picked inside the surface', () => {
    mounts.length = 0
    render(
      <ChiefOfStaffChatSurface
        open
        analyticsSurface="chief_of_staff_page"
        onOpenChange={vi.fn()}
        pendingMessage="young supporters"
      />,
    )
    expect(mounts).toEqual([
      expect.objectContaining({ pendingMessage: 'young supporters' }),
    ])

    act(() => lastSelectConversation?.('conv-7'))

    expect(mounts).toHaveLength(2)
    expect(mounts[1]).toEqual(
      expect.objectContaining({
        conversationIdOverride: 'conv-7',
        pendingMessage: undefined,
      }),
    )
  })
})

describe('ChiefOfStaffChatSurface gone conversation', () => {
  // The Campaign Manager resumes its newest conversation on open, and a file
  // picked from the footer paperclip rides along as `pendingFile`. If that
  // conversation is gone (deleted on another device, or an id read from a list
  // cached before an organization switch), the body 404s it. An override left
  // in place after that keeps the body's pendingFile guard closed for as long
  // as the surface stays mounted, so the file was silently dropped.
  it('drops a gone conversation so a queued file lands on a fresh chat', () => {
    mounts.length = 0
    const file = new File(['hello'], 'brief.txt', { type: 'text/plain' })
    render(
      <ChiefOfStaffChatSurface
        open
        analyticsSurface="campaign_manager_page"
        onOpenChange={vi.fn()}
        initialConversationId="conv-gone"
        pendingFile={file}
      />,
    )
    expect(mounts).toEqual([
      expect.objectContaining({ conversationIdOverride: 'conv-gone' }),
    ])

    act(() => lastConversationGone?.('conv-gone'))

    // A fresh body: no override to block the queued file, and the file is
    // still queued for it.
    expect(mounts).toHaveLength(2)
    expect(mounts[1]).toEqual(
      expect.objectContaining({
        conversationIdOverride: undefined,
        pendingFile: file,
      }),
    )
  })
})
