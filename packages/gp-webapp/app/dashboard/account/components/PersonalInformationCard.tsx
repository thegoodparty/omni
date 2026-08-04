'use client'

import { useUser as useClerkUser, useClerk } from '@clerk/nextjs'
import { Badge, Button, Card } from '@styleguide'
import { User } from 'helpers/types'

interface PersonalInformationCardProps {
  user: User
  title?: string
}

const FieldRow = ({
  label,
  value,
}: {
  label: string
  value?: string | null
}): React.JSX.Element => (
  <div className="flex flex-col gap-0.5">
    <span className="text-xs font-medium text-muted-foreground">{label}</span>
    <p className="m-0 text-sm text-foreground">{value || '—'}</p>
  </div>
)

const formatProvider = (provider?: string): string => {
  if (!provider) return 'Account'
  const name = provider.replace(/^oauth_/, '').replace(/_/g, ' ')
  return name.charAt(0).toUpperCase() + name.slice(1)
}

const ProviderIcon = ({ provider }: { provider?: string }): React.ReactNode => {
  const key = (provider || '').replace(/^oauth_/, '').toLowerCase()
  if (key === 'google') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        />
        <path
          fill="#FBBC05"
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        />
        <path
          fill="#EA4335"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        />
      </svg>
    )
  }
  if (key === 'facebook') {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="#1877F2"
        aria-hidden="true"
      >
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
    )
  }
  return null
}

export const PersonalInformationCard = ({
  user,
  title = 'Personal Information',
}: PersonalInformationCardProps): React.JSX.Element => {
  const { user: clerkUser } = useClerkUser()
  const { openUserProfile } = useClerk()

  const firstName = clerkUser?.firstName || user.firstName || ''
  const lastName = clerkUser?.lastName || user.lastName || ''
  const email = clerkUser?.primaryEmailAddress?.emailAddress || user.email || ''
  const phone = clerkUser?.primaryPhoneNumber?.phoneNumber || user.phone || ''
  const externalAccounts = clerkUser?.externalAccounts ?? []

  return (
    <Card className="w-full max-w-[640px] gap-4 p-6">
      <div className="flex items-center justify-between">
        <h2 className="m-0 text-xl font-semibold text-foreground">{title}</h2>
        <Button
          variant="outline"
          size="small"
          onClick={() => openUserProfile()}
        >
          Edit details
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FieldRow label="First name" value={firstName} />
        <FieldRow label="Last name" value={lastName} />
        <FieldRow label="Email" value={email} />
        <FieldRow label="Phone number" value={phone} />
      </div>

      {externalAccounts.length > 0 && (
        <div>
          <span className="text-xs font-medium text-muted-foreground">
            Connected accounts
          </span>
          <div className="mt-2 flex flex-wrap gap-2">
            {externalAccounts.map((account) => (
              <Badge key={account.id} variant="soft" className="gap-1.5">
                <ProviderIcon provider={account.provider} />
                <strong>{formatProvider(account.provider)}</strong>
                <span>{account.emailAddress || account.username || ''}</span>
              </Badge>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
