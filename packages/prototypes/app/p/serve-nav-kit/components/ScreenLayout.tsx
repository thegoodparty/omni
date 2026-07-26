'use client'

import { type ReactNode } from 'react'
import { IconButton, PageHeader, useSidebar } from '@goodparty_org/styleguide'
import { MenuIcon } from '@styleguide/components/ui/icons'
import { AiPromptBar } from './AiPromptBar'

type ScreenLayoutProps = {
  title: string
  /** Sub-bar back button (styled by PageHeader): arrow + this label. */
  onBack?: () => void
  backLabel?: string
  /** Sub-bar right slot (download, Create new list, …). Sticky, both breakpoints. */
  actions?: ReactNode
  /** Sub-bar center slot (e.g. a search field). Sticky, both breakpoints. */
  subContent?: ReactNode
  aiPlaceholder?: string
  /** Hide the persistent AI bar (e.g. empty-state screens). */
  hideAiBar?: boolean
  /**
   * Content column width. `default` = gp-webapp's 720px reading/dashboard column.
   * `wide` = broader hub layout for channel grids + data tables.
   */
  width?: 'default' | 'wide'
  /**
   * Full-bleed body: drop the padded, max-width content column so the child
   * controls its own layout edge-to-edge (e.g. a map-dominant screen).
   */
  bleed?: boolean
  children: ReactNode
}

const WIDTH_CLASS: Record<'default' | 'wide', string> = {
  default: 'max-w-[720px]',
  wide: 'max-w-7xl',
}

// One styleguide `PageHeader` per screen, handling BOTH breakpoints: main bar
// (default logo + heading; the logo and the burger are lg:hidden) plus an optional
// sub-bar. The whole header is sticky (built into PageHeader), so the sub-bar sits
// directly under the main bar with no overlap. The burger opens the mobile rail.
export const ScreenLayout = ({
  title,
  onBack,
  backLabel,
  actions,
  subContent,
  aiPlaceholder,
  hideAiBar = false,
  width = 'default',
  bleed = false,
  children,
}: ScreenLayoutProps) => {
  const { setOpenMobile } = useSidebar()
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        heading={title}
        onBack={onBack}
        backLabel={backLabel}
        trailing={
          <IconButton
            variant="ghost"
            size="small"
            onClick={() => setOpenMobile(true)}
            aria-label="Open menu"
          >
            <MenuIcon size={20} />
          </IconButton>
        }
        subBarContent={subContent}
        subBarTrailing={actions}
      />

      {bleed ? (
        <div className="flex min-h-0 w-full flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          {!hideAiBar && <AiPromptBar placeholder={aiPlaceholder} />}
        </div>
      ) : (
        <div
          className={`mx-auto flex w-full flex-1 flex-col ${WIDTH_CLASS[width]}`}
        >
          <div className="flex-1 space-y-5 px-4 py-5 pb-24 sm:space-y-6 sm:px-6 lg:px-8">
            {children}
          </div>
          {!hideAiBar && <AiPromptBar placeholder={aiPlaceholder} />}
        </div>
      )}
    </div>
  )
}
