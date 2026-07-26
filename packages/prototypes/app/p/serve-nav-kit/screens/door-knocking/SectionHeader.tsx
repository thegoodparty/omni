import { type ReactNode } from 'react'

type Props = {
  title: string
  description?: string
  action?: ReactNode
}

export const SectionHeader = ({ title, description, action }: Props) => (
  <div className="flex flex-col">
    <div className="flex min-h-6 items-center justify-between gap-2">
      <h2 className="text-foreground text-base font-semibold">{title}</h2>
      {action}
    </div>
    {description && (
      <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>
    )}
  </div>
)
