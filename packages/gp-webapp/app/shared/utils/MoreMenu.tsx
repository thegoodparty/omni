import { useRef, useState } from 'react'
import { noop } from './noop'
import { MoreHorizontalIcon } from '@styleguide/components/ui/icons'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@styleguide/components/ui/dropdown-menu'

interface MoreMenuItem {
  label: string
  onClick?: () => void
}

interface MoreMenuProps {
  onClose?: (menuItem?: MoreMenuItem) => void
  menuItems?: MoreMenuItem[]
}

export const MoreMenu = ({
  onClose = noop,
  menuItems = [],
}: MoreMenuProps): React.JSX.Element => {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      onClose()
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-label="More options"
          // 20px, a card title's line height, so it sits level with the
          // title; the padding keeps the tap target at 32px without moving it.
          className="text-muted-foreground hover:text-foreground focus-visible:ring-primary-focus -m-1.5 cursor-pointer rounded-md p-1.5 outline-none focus-visible:ring-[3px]"
        >
          <MoreHorizontalIcon className="size-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        // Focus goes back to the button, but without scrolling: an action
        // can move its row (a task put off sorts later), and following the
        // button there would yank the page away from where the person was.
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          triggerRef.current?.focus({ preventScroll: true })
        }}
      >
        {menuItems.map((menuItem, index) => {
          const { onClick = noop, label } = menuItem
          return (
            <DropdownMenuItem
              key={index}
              onClick={() => {
                handleOpenChange(false)
                onClick()
              }}
            >
              {label}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
