import { ReactNode } from 'react'
import { GoodPartyOrgLogoWordmark, LoaderCircleIcon } from '@styleguide'

export const EmailPublicCard = ({
  title,
  caption,
  children,
}: {
  title: string
  caption?: string
  children?: ReactNode
}) => (
  <div className="space-y-6 rounded-lg bg-white p-8 shadow-sm">
    <GoodPartyOrgLogoWordmark />
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
      {caption && <p className="text-muted-foreground">{caption}</p>}
    </div>
    {children}
  </div>
)

export const EmailPublicLoading = () => (
  <div className="flex justify-center py-16" role="status">
    <LoaderCircleIcon className="animate-spin" aria-label="Loading" />
  </div>
)

export const InvalidLinkCard = () => (
  <EmailPublicCard
    title="This link isn't valid"
    caption="It may be incomplete or out of date. Use the link in your most recent email."
  />
)
