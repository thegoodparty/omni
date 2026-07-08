'use client'

import { useState } from 'react'
import { Card } from '@styleguide'
import { Pencil, UserRound } from 'lucide-react'
import { useUser } from '@shared/hooks/useUser'
import { User } from 'helpers/types'
import UploadAvatarDialog from './UploadAvatarDialog'

interface ProfileHeroCardProps {
  user: User | null
}

export default function ProfileHeroCard({
  user: serverUser,
}: ProfileHeroCardProps): React.JSX.Element {
  const [user, setUser] = useUser()
  const [uploadOpen, setUploadOpen] = useState(false)

  const activeUser = user ?? serverUser
  const avatar = activeUser?.avatar || ''
  const displayName =
    activeUser?.name ||
    [activeUser?.firstName, activeUser?.lastName].filter(Boolean).join(' ') ||
    'Your profile'

  const handleSaved = (avatarUrl: string): void => {
    if (activeUser) {
      setUser({ ...activeUser, avatar: avatarUrl })
    }
  }

  return (
    <Card className="w-full max-w-[640px] p-4">
      <div className="flex items-center gap-6">
        <button
          type="button"
          onClick={() => setUploadOpen(true)}
          aria-label="Change profile image"
          className="group relative flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted"
        >
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatar}
              alt={displayName}
              className="size-full rounded-2xl object-cover"
            />
          ) : (
            <UserRound className="size-12 text-muted-foreground" />
          )}
          <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
            <Pencil className="size-6 text-white" />
          </div>
        </button>
        <div>
          <h2 className="m-0 text-2xl font-bold text-foreground">
            {displayName}
          </h2>
          <p className="m-0 text-muted-foreground">
            Manage your profile information
          </p>
        </div>
      </div>

      <UploadAvatarDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        currentImage={avatar || null}
        onSave={handleSaved}
      />
    </Card>
  )
}
