'use client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import { Switch } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import { useSnackbar } from 'helpers/useSnackbar'
import { useServeCitizenPanelsFlag } from 'app/shared/experiments/serveCitizenPanelsFlag'
import type {
  CivicPanelActivity,
  ContactStatusSource,
} from '@goodparty_org/contracts'
import type {
  CivicPanelStatus,
  CivicPanelStatusResponse,
  Person,
} from '../shared/contacts-types'

interface CivicPanelRowProps {
  person: Person
  isServe: boolean
}

// Every string under the toggle, in one SERVE_* declaration so the
// vocabulary gate reads it.
const SERVE_CIVIC_PANEL_ACTIVITY_COPY: {
  joined: Record<ContactStatusSource, string>
  left: Record<ContactStatusSource, string>
  lastAsked: string
} = {
  joined: {
    sms: 'Joined by text',
    door_knock: 'Joined at the door',
    phone_banking: 'Joined on a call',
    manual: 'Added by you',
    share_page: 'Joined',
  },
  left: {
    sms: 'Left by text',
    door_knock: 'Left at the door',
    phone_banking: 'Left on a call',
    manual: 'Removed by you',
    share_page: 'Left the panel',
  },
  lastAsked: 'Last asked',
}

// "Oct 2", with the year only when it isn't this one.
const formatDay = (iso: string, now: Date): string => {
  const date = new Date(iso)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  })
}

// One short line from the latest join or leave and the last time the
// office reached them, e.g. "Joined by text on Oct 2 · Last asked Sep 30".
export const civicPanelActivityLine = (
  activity: CivicPanelActivity | undefined,
  now: Date = new Date(),
): string | null => {
  if (!activity) return null
  const parts: string[] = []
  const change = activity.latestChange
  if (change) {
    const phrases =
      change.value === 'member'
        ? SERVE_CIVIC_PANEL_ACTIVITY_COPY.joined
        : SERVE_CIVIC_PANEL_ACTIVITY_COPY.left
    parts.push(`${phrases[change.source]} on ${formatDay(change.at, now)}`)
  }
  if (activity.lastReachedAt) {
    parts.push(
      `${SERVE_CIVIC_PANEL_ACTIVITY_COPY.lastAsked} ${formatDay(activity.lastReachedAt, now)}`,
    )
  }
  return parts.length > 0 ? parts.join(' · ') : null
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
      errorSnackbar("Couldn't update the civic panel. Please try again.")
    },
    onSuccess: (data, _value, context) => {
      queryClient.setQueryData<Person>(personQueryKey, (current) => {
        if (!current) return current
        // The PATCH answers with the status alone, so the line under the
        // toggle reads the by-hand change from here rather than a refetch.
        const changed = context?.fromValue !== data.civicPanel
        return {
          ...current,
          civicPanel: data.civicPanel,
          ...(changed && current.civicPanelActivity
            ? {
                civicPanelActivity: {
                  ...current.civicPanelActivity,
                  latestChange: {
                    value: data.civicPanel,
                    source: 'manual' as const,
                    at: new Date().toISOString(),
                  },
                },
              }
            : {}),
        }
      })
      queryClient.invalidateQueries({
        queryKey: ['contact-engagement', 'activities'],
      })
    },
  })

  if (!isServe || !citizenPanelsEnabled) return null

  const activityLine = civicPanelActivityLine(person.civicPanelActivity)

  return (
    <div className="mb-6 flex flex-col gap-1">
      <label className="flex w-fit items-center gap-3 text-sm font-medium">
        <Switch
          aria-label="On your civic panel"
          checked={civicPanel === 'member'}
          disabled={civicPanelMutation.isPending}
          onCheckedChange={(checked) =>
            civicPanelMutation.mutate(checked ? 'member' : 'left')
          }
        />
        On your civic panel
      </label>
      {activityLine && (
        <p className="text-sm text-muted-foreground">{activityLine}</p>
      )}
    </div>
  )
}
