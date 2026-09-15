import * as React from 'react'

import { cn } from '@styleguide/lib/utils'
import { Card } from './card'
import { Button, type ButtonProps } from './button'

type ContentCardAction = {
  label: React.ReactNode
} & Omit<ButtonProps, 'children' | 'variant'>

interface ContentCardProps extends Omit<
  React.ComponentProps<typeof Card>,
  'title'
> {
  title: React.ReactNode
  description?: React.ReactNode
  overline?: React.ReactNode
  overlineEmphasis?: boolean
  helper?: React.ReactNode
  primaryAction?: ContentCardAction
  secondaryAction?: ContentCardAction
}

const renderAction = (
  action: ContentCardAction | undefined,
  variant: ButtonProps['variant'],
) => {
  if (!action) return null
  const { label, className: actionClassName, ...buttonProps } = action
  return (
    <Button
      variant={variant}
      className={cn('w-full min-[600px]:w-auto', actionClassName)}
      {...buttonProps}
    >
      {label}
    </Button>
  )
}

function ContentCard({
  title,
  description,
  overline,
  overlineEmphasis = true,
  helper,
  primaryAction,
  secondaryAction,
  children,
  className,
  ...props
}: ContentCardProps) {
  const hasActions = Boolean(primaryAction || secondaryAction)

  return (
    <Card
      data-slot="content-card"
      className={cn(
        'border-components-card-border gap-4 rounded-2xl p-6',
        className,
      )}
      {...props}
    >
      <div className="flex w-full flex-col gap-1">
        {overline || helper ? (
          <div className="flex min-h-7 flex-wrap items-center gap-2">
            {overline ? (
              <span
                className={cn(
                  'flex-1 text-xs font-bold whitespace-nowrap uppercase',
                  overlineEmphasis ? 'text-primary' : 'text-card-foreground',
                )}
              >
                {overline}
              </span>
            ) : null}
            {helper ? (
              <div className="text-muted-foreground ml-auto flex shrink-0 items-center [&_svg]:size-6">
                {helper}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="text-card-foreground text-lg leading-7 font-semibold">
          {title}
        </div>
        {description ? (
          <div className="text-card-foreground text-base leading-6">
            {description}
          </div>
        ) : null}
      </div>

      {children ? <div className="w-full">{children}</div> : null}

      {hasActions ? (
        <div className="flex w-full flex-col items-stretch gap-4 pt-2 min-[600px]:flex-row-reverse min-[600px]:items-center min-[600px]:justify-start">
          {renderAction(primaryAction, 'default')}
          {renderAction(secondaryAction, 'neutral')}
        </div>
      ) : null}
    </Card>
  )
}

export { ContentCard, type ContentCardProps, type ContentCardAction }
