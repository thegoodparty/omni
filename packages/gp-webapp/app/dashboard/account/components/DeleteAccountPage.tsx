'use client'

import { useState } from 'react'
import { useClerk } from '@clerk/nextjs'
import { useUser } from '@shared/hooks/useUser'
import { clientFetch } from 'gpApi/clientFetch'
import { apiRoutes } from 'gpApi/routes'
import { buttonVariants } from '@styleguide/components/ui/button'
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
  Button,
  Card,
} from '@styleguide/components/ui'

export default function DeleteAccountPage(): React.JSX.Element {
  const [user] = useUser()
  const { signOut } = useClerk()
  const [modalOpen, setModalOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDeleteConfirm = async () => {
    if (!user?.id) return
    setLoading(true)
    setError(null)

    try {
      const resp = await clientFetch(apiRoutes.user.deleteAccount, {
        id: user.id,
      })

      if (resp.ok || resp.status === 404) {
        await signOut({ redirectUrl: '/' })
        return
      }

      setError(
        'Failed to delete your account. Please try again or contact support.',
      )
    } catch {
      setError(
        'An unexpected error occurred. Please try again or contact support.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="w-full max-w-[640px] gap-4 p-6">
      <h2 className="m-0 text-xl font-semibold text-foreground">
        Delete Account
      </h2>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-0.5">
          <p className="m-0 text-base font-medium text-foreground">
            Permanently delete your account
          </p>
          <p className="m-0 text-sm text-muted-foreground">
            This action is not reversible. All your campaign data will be
            permanently deleted.
          </p>
        </div>
        <Button
          variant="destructive"
          className="shrink-0"
          onClick={() => {
            setError(null)
            setModalOpen(true)
          }}
        >
          Delete Account
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <AlertDialog
        open={modalOpen}
        onOpenChange={(open) => {
          if (!loading) setModalOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. All your campaign data will be permanently
              deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={handleDeleteConfirm}
              disabled={loading}
            >
              {loading ? 'Deleting...' : 'Delete My Account'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
