'use client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import { Switch } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import type {
  FollowUpStatus,
  FollowUpStatusResponse,
  Person,
} from '../shared/contacts-types'

interface FollowUpRowProps {
  person: Person
  // The same Serve signal StatusRow gates its Win dropdowns on, inverted.
  isServe: boolean
}

// Serve's counterpart to StatusRow: the standing "this constituent asked to
// be followed up with" flag, toggled as the official works through people.
// A switch rather than a dropdown because the door and the call both ask a
// yes/no question, and the absence of an answer means nothing is owed.
// Mounted unconditionally by PersonOverlay and self-gating on Serve, the same
// convention StatusRow uses for Win.
export default function FollowUpRow({
  person,
  isServe,
}: FollowUpRowProps): React.JSX.Element | null {
  const orgSlug = useOrganization()?.slug
  const queryClient = useQueryClient()
  const { errorSnackbar } = useSnackbar()
  const personQueryKey = ['person', orgSlug, person.id]

  const followUp: FollowUpStatus = person.followUp ?? 'cleared'

  // Scoped to this one field for the reason StatusRow's two mutations are:
  // a whole-Person snapshot/restore would clobber whatever another in-flight
  // mutation had already committed. `context.fromValue` comes from this
  // component's prop-derived value at click time, so it is both the rollback
  // target and the analytics `from`.
  const followUpMutation = useMutation<
    FollowUpStatusResponse,
    FetchError,
    FollowUpStatus,
    { fromValue: FollowUpStatus }
  >({
    mutationFn: (value) =>
      clientRequest('PATCH /v1/contacts/:personId/follow-up', {
        personId: person.id,
        value,
      }).then((res) => res.data),
    onMutate: (value) => {
      const fromValue = followUp
      queryClient.setQueryData<Person>(personQueryKey, (current) =>
        current ? { ...current, followUp: value } : current,
      )
      return { fromValue }
    },
    onError: (_error, _value, context) => {
      if (context) {
        queryClient.setQueryData<Person>(personQueryKey, (current) =>
          current ? { ...current, followUp: context.fromValue } : current,
        )
      }
      errorSnackbar("Couldn't update follow-up. Please try again.")
    },
    onSuccess: (data, value, context) => {
      queryClient.setQueryData<Person>(personQueryKey, (current) =>
        current ? { ...current, followUp: data.followUp } : current,
      )
      queryClient.invalidateQueries({
        queryKey: ['contact-engagement', 'activities'],
      })
      trackEvent(EVENTS.ConstituentData.FollowUpChanged, {
        from: context.fromValue,
        to: value,
      })
    },
  })

  if (!isServe) return null

  return (
    <label className="mb-6 flex w-fit items-center gap-3 text-sm font-medium">
      <Switch
        aria-label="Asked for follow-up"
        checked={followUp === 'requested'}
        disabled={followUpMutation.isPending}
        onCheckedChange={(checked) =>
          followUpMutation.mutate(checked ? 'requested' : 'cleared')
        }
      />
      Asked for follow-up
    </label>
  )
}
