'use client'
import { useClerk } from '@clerk/nextjs'
import { Button } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { useSnackbar } from 'helpers/useSnackbar'
import { clearElectionResultDismissed } from 'app/dashboard/election-result/dismissal'

interface ImpersonateActionProps {
  email: string
  isCandidate: boolean
  launched?: string
}

export default function ImpersonateAction({
  email,
  isCandidate,
  launched: launchStatus,
}: ImpersonateActionProps): React.JSX.Element {
  const { successSnackbar, errorSnackbar } = useSnackbar()
  const { signOut, client, setActive } = useClerk()

  const handleImpersonateUser = async () => {
    successSnackbar('Impersonating user')

    try {
      const searchResp = await clientRequest('GET /v1/admin/users/search', {
        email,
      })
      const match = searchResp.ok
        ? searchResp.data.find((user) => user.email === email)
        : undefined
      if (!match) throw new Error('User not found')

      const resp = await clientRequest(
        'POST /v1/admin/users/impersonate/:userId',
        { userId: String(match.id) },
      )
      if (!resp.ok) throw new Error('Failed to impersonate')

      const { token } = resp.data
      await signOut()
      const result = await client.signIn.create({
        strategy: 'ticket',
        ticket: token,
      })
      if (result.status !== 'complete' || !result.createdSessionId) {
        throw new Error('Impersonation sign-in incomplete')
      }
      await setActive({ session: result.createdSessionId })
      clearElectionResultDismissed()

      if (isCandidate && launchStatus === 'Live') {
        window.location.href = `/dashboard`
      } else {
        window.location.href = '/'
      }
    } catch {
      errorSnackbar('Impersonate failed')
    }
  }

  return (
    <Button
      onClick={handleImpersonateUser}
      size="small"
      className="w-full font-semibold"
    >
      <span className="whitespace-nowrap">Impersonate</span>
    </Button>
  )
}
