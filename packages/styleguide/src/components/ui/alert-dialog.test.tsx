import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from './alert-dialog'

// The scrim is a sibling of the content inside the portal, not the element
// `className` lands on, so a caller raising the dialog above another layer
// needs its own prop to raise the scrim with it.
describe('AlertDialogContent', () => {
  const renderOpen = (overlayClassName?: string) =>
    render(
      <AlertDialog open>
        <AlertDialogContent
          className="z-[1500]"
          overlayClassName={overlayClassName}
        >
          <AlertDialogTitle>Delete Downtown?</AlertDialogTitle>
          <AlertDialogDescription>Gone for good.</AlertDialogDescription>
        </AlertDialogContent>
      </AlertDialog>,
    )

  const overlay = () =>
    document.querySelector('[data-slot="alert-dialog-overlay"]')

  it('puts overlayClassName on the scrim, not on the content', () => {
    renderOpen('z-[1500]')

    expect(overlay()).toHaveClass('z-[1500]')
    expect(screen.getByRole('alertdialog')).toHaveClass('z-[1500]')
  })

  it('keeps the default scrim when none is given', () => {
    renderOpen()

    expect(overlay()).toHaveClass('z-50')
    expect(overlay()).not.toHaveClass('z-[1500]')
  })
})
