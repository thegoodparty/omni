'use client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import { Switch } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import { useSnackbar } from 'helpers/useSnackbar'
import { useServeCitizenPanelsFlag } from 'app/shared/experiments/serveCitizenPanelsFlag'
import type {
  CivicPanelStatus,
  CivicPanelStatusResponse,
  Person,
} from '../shared/contacts-types'

interface CivicPanelRowProps {
  person: Person
  isServe: boolean
}

// Serve's civic panel membership, beside the follow-up switch and built the
// same way: a by-hand toggle on the standing field that a yes to a panel
// invitation also writes, self-gating on Serve.
export default function CivicPanelRow({
  person,
  isServe,
}: CivicPanelRowProps): React.JSX.Element | null {
  const orgSlug = useOrganization()?.slug
  const queryClient = useQueryClient()
  const { errorSnackbar } = useSnackbar()
  const { enabled: citizenPanelsEnabled } = useServeCitizenPanelsFlag(isServe)
  const personQueryKey = ['person', orgSlug, person.id]

  const civicPanel: CivicPanelStatus = person.civicPanel ?? 'left'

  const civicPanelMutation = useMutation<
    CivicPanelStatusResponse,
    FetchError,
    CivicPanelStatus,
    { fromValue: CivicPanelStatus }
  >({
    mutationFn: (value) =>
      clientRequest('PATCH /v1/contacts/:personId/civic-panel', {
        personId: person.id,
        value,
      }).then((res) => res.data),
    onMutate: (value) => {
      const fromValue = civicPanel
      queryClient.setQueryData<Person>(personQueryKey, (current) =>
        current ? { ...current, civicPanel: value } : current,
      )
      return { fromValue }
    },
    onError: (_error, _value, context) => {
      if (context) {
        queryClient.setQueryData<Person>(personQueryKey, (current) =>
          current ? { ...current, civicPanel: context.fromValue } : current,
        )
      }
      errorSnackbar("Couldn't update the citizens' panel. Please try again.")
    },
    onSuccess: (data) => {
      queryClient.setQueryData<Person>(personQueryKey, (current) =>
        current ? { ...current, civicPanel: data.civicPanel } : current,
      )
      queryClient.invalidateQueries({
        queryKey: ['contact-engagement', 'activities'],
      })
    },
  })

  if (!isServe || !citizenPanelsEnabled) return null

  return (
    <label className="mb-6 flex w-fit items-center gap-3 text-sm font-medium">
      <Switch
        aria-label="On your citizens' panel"
        checked={civicPanel === 'member'}
        disabled={civicPanelMutation.isPending}
        onCheckedChange={(checked) =>
          civicPanelMutation.mutate(checked ? 'member' : 'left')
        }
      />
      On your citizens&apos; panel
    </label>
  )
}
