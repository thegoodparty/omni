'use client'
import { useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { PhoneIcon } from '@styleguide/components/ui/icons'
import {
  DetailsSection,
  Metric,
  MetricGrid,
} from './listDetails/ListDetailsMetric'

interface FollowUpOutstandingSectionProps {
  outreachId: number
  // Nullable: a campaign can reach results without ever being named, and
  // the saved list still needs something an official will recognise.
  outreachName: string | null | undefined
  // Serve's hub hands this in to open the phone-banking flow on the list this
  // section just saved. Omitted by any caller that cannot open a flow, which
  // is what keeps the section useful (Save as list still works) rather than
  // broken, when it is mounted somewhere without one.
  onCallList?: (listId: number, listName: string) => void
}

// The audience: reached by THIS campaign, and still owed a follow-up now.
// `followUpRequested` reads the standing flag, so anyone already followed up
// with — by a later call, a later knock, or the contact card's toggle — is
// gone from it. That is deliberately not the same question as the "Needs
// follow-up: Yes" row above, which counts what was said on the calls and can
// only ever grow.
const audiencePayload = (outreachId: number) => ({
  followUpRequested: true,
  activityConditions: [
    { outreachType: 'phoneBanking' as const, outreachId, actions: [] },
  ],
})

export const FollowUpOutstandingSection = ({
  outreachId,
  outreachName,
  onCallList,
}: FollowUpOutstandingSectionProps): React.JSX.Element | null => {
  const listName = `${outreachName?.trim() || 'Phone banking'} — follow-ups`
  const orgSlug = useOrganization()?.slug
  const { errorSnackbar, successSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  // Refs, not state: the guard has to be set BEFORE the first await, and a
  // state update is not visible to a second handler dispatched in the same
  // tick. A double-tap (ordinary on mobile) would otherwise have both
  // closures read null and save the list twice — `isPending` has not
  // re-rendered the disabled button by then either.
  const savedListRef = useRef<{ id: number; name: string } | null>(null)
  const inFlightRef = useRef<Promise<{ id: number; name: string }> | null>(null)

  const outstandingQuery = useQuery({
    queryKey: ['follow-up-outstanding', orgSlug, outreachId],
    queryFn: async () => {
      const { data } = await clientRequest(
        'POST /v1/contacts/count',
        audiencePayload(outreachId),
      )
      return data.count
    },
    staleTime: 30_000,
  })

  // One saved list backs both actions, because a saved list is what every
  // channel already consumes — phone banking builds its call sheet from one,
  // and so does everything else. Reused rather than re-created on a second
  // click, so working the list and then exporting it does not leave two
  // identical lists behind.
  const saveList = useMutation({
    mutationFn: () => {
      if (savedListRef.current) {
        return Promise.resolve(savedListRef.current)
      }
      // A second tap joins the in-flight save rather than starting its own.
      if (inFlightRef.current) {
        return inFlightRef.current
      }
      const pending = clientRequest('POST /v1/voters/voter-file/filter', {
        name: listName,
        ...audiencePayload(outreachId),
      })
        .then(({ data }) => {
          const saved = { id: data.id, name: data.name ?? listName }
          savedListRef.current = saved
          return saved
        })
        .finally(() => {
          inFlightRef.current = null
        })
      inFlightRef.current = pending
      return pending
    },
    onSuccess: () => {
      // Every other list-create path refreshes these two; without it the CRM
      // lists index and the audience picker keep serving a set that does not
      // contain the list we just told the official about.
      queryClient.invalidateQueries({ queryKey: ['custom-segments', orgSlug] })
      queryClient.invalidateQueries({
        queryKey: ['outreach-audience-lists', orgSlug],
      })
    },
    onError: () => {
      errorSnackbar("Couldn't build the follow-up list. Please try again.")
    },
  })

  const outstanding = outstandingQuery.data

  // Nothing outstanding is a real answer and worth showing — it is how an
  // official sees the work is done. An unresolved or failed count is not: two
  // buttons over an unknown audience would be a worse affordance than none.
  if (outstandingQuery.isError || outstanding === undefined) {
    return null
  }

  const handleSave = async () => {
    const list = await saveList.mutateAsync().catch(() => null)
    if (list) {
      trackEvent(EVENTS.ConstituentData.FollowUpListCreated, {
        action: 'save',
        outstanding,
      })
      successSnackbar(`Saved "${list.name}" to your lists.`)
    }
  }

  const handleCall = async () => {
    const list = await saveList.mutateAsync().catch(() => null)
    if (list && onCallList) {
      trackEvent(EVENTS.ConstituentData.FollowUpListCreated, {
        action: 'call',
        outstanding,
      })
      // Calling saves a list too; saying so is what stops the official
      // finding an unexplained list in Constituent Data later.
      successSnackbar(`Saved "${list.name}" to your lists.`)
      onCallList(list.id, list.name)
    }
  }

  return (
    <DetailsSection title="Follow-ups outstanding">
      <MetricGrid>
        <Metric
          icon={<PhoneIcon />}
          label="Asked for follow-up"
          value={String(outstanding)}
        />
      </MetricGrid>
      <p className="text-sm text-muted-foreground">
        People who requested a follow-up during the course of your campaign
      </p>
      {outstanding > 0 && (
        <div className="flex flex-wrap gap-2">
          {onCallList && (
            <Button
              type="button"
              size="small"
              onClick={handleCall}
              loading={saveList.isPending}
            >
              Call them back
            </Button>
          )}
          <Button
            type="button"
            size="small"
            variant="outline"
            onClick={handleSave}
            disabled={saveList.isPending}
          >
            Save as list
          </Button>
        </div>
      )}
    </DetailsSection>
  )
}
