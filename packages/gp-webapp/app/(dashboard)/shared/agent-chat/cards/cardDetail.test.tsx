import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import {
  CardDetail,
  CardDetailProvider,
  CardDetailSheetHost,
} from './cardDetail'

const Card = ({ detailKey, label }: { detailKey: string; label: string }) => (
  <CardDetail
    detailKey={detailKey}
    title={label}
    chip={({ open, expanded }) => (
      <button type="button" aria-expanded={expanded} onClick={open}>
        {label} chip
      </button>
    )}
  >
    <p>{label} detail</p>
  </CardDetail>
)

const Thread = ({ children }: { children: React.ReactNode }) => (
  <CardDetailProvider>
    {children}
    <CardDetailSheetHost />
  </CardDetailProvider>
)

describe('CardDetail', () => {
  it('opens one detail at a time in the host, and swaps it for the next', async () => {
    const user = userEvent.setup()
    render(
      <Thread>
        <Card detailKey="a" label="Mark" />
        <Card detailKey="b" label="Ada" />
      </Thread>,
    )
    expect(screen.queryByText('Mark detail')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Mark chip' }))
    const panel = within(await screen.findByRole('dialog'))
    expect(panel.getByText('Mark detail')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Ada chip' }))

    const next = within(await screen.findByRole('dialog'))
    expect(next.getByText('Ada detail')).toBeInTheDocument()
    expect(next.queryByText('Mark detail')).toBeNull()
  })

  // Chief of Staff swaps the whole thread when another conversation opens;
  // the panel must not stay open on a card that is no longer there.
  it('closes when the card that owns the open detail goes away', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <Thread>
        <Card detailKey="call:tc-1" label="Mark" />
      </Thread>,
    )
    await user.click(screen.getByRole('button', { name: 'Mark chip' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    rerender(
      <Thread>
        <Card detailKey="call:tc-9" label="Ada" />
      </Thread>,
    )

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('button', { name: 'Ada chip' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  // A live card and its persisted copy are different elements with one key.
  // The turn settling swaps one for the other under an open panel.
  it('stays open when the card under it is replaced by one with the same key', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <Thread>
        <Card key="live" detailKey="call:tc-1" label="Live" />
      </Thread>,
    )
    await user.click(screen.getByRole('button', { name: 'Live chip' }))
    expect(await screen.findByText('Live detail')).toBeInTheDocument()

    rerender(
      <Thread>
        <Card key="persisted" detailKey="call:tc-1" label="Persisted" />
      </Thread>,
    )

    const panel = within(await screen.findByRole('dialog'))
    expect(await panel.findByText('Persisted detail')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Persisted chip', hidden: true }),
    ).toHaveAttribute('aria-expanded', 'true')
  })
})
