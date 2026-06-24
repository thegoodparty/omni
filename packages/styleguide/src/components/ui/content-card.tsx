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
  eyebrow?: React.ReactNode
  eyebrowIcon?: React.ReactNode
  eyebrowEmphasis?: boolean
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
  eyebrow,
  eyebrowIcon,
  eyebrowEmphasis = true,
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
        {eyebrow || helper ? (
          <div className="flex min-h-7 flex-wrap items-center gap-2">
            {eyebrow ? (
              <div
                className={cn(
                  'flex flex-1 items-center gap-1 [&_svg]:size-4',
                  eyebrowEmphasis ? 'text-primary' : 'text-card-foreground',
                )}
              >
                {eyebrowIcon}
                <span className="text-xs font-bold whitespace-nowrap uppercase">
                  {eyebrow}
                </span>
              </div>
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
        <div className="flex w-full flex-col items-stretch gap-4 pt-2 min-[600px]:flex-row min-[600px]:items-center min-[600px]:justify-end">
          {renderAction(secondaryAction, 'neutral')}
          {renderAction(primaryAction, 'default')}
        </div>
      ) : null}
    </Card>
  )
}

export { ContentCard, type ContentCardProps, type ContentCardAction }
