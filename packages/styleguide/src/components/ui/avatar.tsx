'use client'

import * as React from 'react'
import * as AvatarPrimitive from '@radix-ui/react-avatar'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@styleguide/lib/utils'

const avatarVariants = cva('relative flex shrink-0 overflow-hidden', {
  variants: {
    size: {
      small: 'size-8',
      medium: 'size-10',
      large: 'size-12',
      xLarge: 'size-14',
      xxLarge: 'size-16',
    },
    shape: {
      circle: 'rounded-full',
      square: 'rounded-base',
    },
  },
  defaultVariants: {
    size: 'medium',
    shape: 'circle',
  },
})

type AvatarSize = 'small' | 'medium' | 'large' | 'xLarge' | 'xxLarge'
type AvatarShape = 'circle' | 'square'

type AvatarContext = { size: AvatarSize; shape: AvatarShape }

const AvatarCtx = React.createContext<AvatarContext>({
  size: 'medium',
  shape: 'circle',
})

const fallbackTextSize: Record<AvatarSize, string> = {
  small: 'text-xs',
  medium: 'text-sm',
  large: 'text-base',
  xLarge: 'text-xl',
  xxLarge: 'text-2xl',
}

const iconSize: Record<AvatarSize, string> = {
  small: '[&>svg]:size-4',
  medium: '[&>svg]:size-5',
  large: '[&>svg]:size-6',
  xLarge: '[&>svg]:size-7',
  xxLarge: '[&>svg]:size-8',
}

interface AvatarProps
  extends
    React.ComponentProps<typeof AvatarPrimitive.Root>,
    VariantProps<typeof avatarVariants> {}

function Avatar({ className, size, shape, ...props }: AvatarProps) {
  return (
    <AvatarCtx.Provider
      value={{ size: size ?? 'medium', shape: shape ?? 'circle' }}
    >
      <AvatarPrimitive.Root
        data-slot="avatar"
        className={cn(avatarVariants({ size, shape, className }))}
        {...props}
      />
    </AvatarCtx.Provider>
  )
}

function AvatarImage({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn('aspect-square size-full object-cover', className)}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  const { size, shape } = React.useContext(AvatarCtx)
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        'flex size-full items-center justify-center bg-muted border border-base-border text-foreground font-medium',
        shape === 'square' ? 'rounded-base' : 'rounded-full',
        fallbackTextSize[size],
        className,
      )}
      {...props}
    />
  )
}

function AvatarIcon({
  className,
  children,
  ...props
}: React.ComponentProps<'div'>) {
  const { size, shape } = React.useContext(AvatarCtx)
  return (
    <div
      data-slot="avatar-icon"
      className={cn(
        'flex size-full items-center justify-center bg-muted border border-base-border text-foreground',
        shape === 'square' ? 'rounded-base' : 'rounded-full',
        iconSize[size],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

// Compound component pattern
Avatar.Image = AvatarImage
Avatar.Fallback = AvatarFallback
Avatar.Icon = AvatarIcon

export { Avatar, AvatarImage, AvatarFallback, AvatarIcon }
