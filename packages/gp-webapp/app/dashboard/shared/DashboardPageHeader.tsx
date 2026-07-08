'use client'

import { ReactNode } from 'react'
import { Button } from '@styleguide'

interface PageHeaderAction {
  label: string
  icon?: ReactNode
  onClick: () => void
}

interface DashboardPageHeaderProps {
  title: string
  description?: string
  primaryAction?: PageHeaderAction
}

export default function DashboardPageHeader({
  title,
  description,
  primaryAction,
}: DashboardPageHeaderProps): React.JSX.Element {
  return (
    <div className="flex w-full flex-col items-start gap-4 border-b border-border bg-background px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-8 md:px-6">
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="m-0 text-base font-semibold text-foreground">{title}</h1>
        {description && (
          <p className="m-0 text-sm font-normal text-muted-foreground">
            {description}
          </p>
        )}
      </div>

      {primaryAction && (
        <Button
          size="small"
          className="w-full rounded-full sm:w-auto"
          onClick={primaryAction.onClick}
          icon={primaryAction.icon}
          iconPosition="right"
        >
          {primaryAction.label}
        </Button>
      )}
    </div>
  )
}
