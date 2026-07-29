'use client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import {
  Badge,
  cn,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useCrmEnabled } from '../../../shared/useCrmEnabled'
import type {
  ContactStatuses,
  Person,
  SupportStatusRollup,
  VoterLikelihood,
} from '../shared/contacts-types'

// The five Voter Likelihood options, color-coded per the prototype (Unknown
// neutral, First time amber, Unlikely red, Likely blue, Super green).
const VOTER_LIKELIHOOD_OPTIONS: { value: VoterLikelihood; label: string }[] = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'first_time', label: 'First time' },
  { value: 'unlikely', label: 'Unlikely' },
  { value: 'likely', label: 'Likely' },
  { value: 'super', label: 'Super' },
]

// border/bg/text pill classes, matching the OptedInChip precedent
// (border-{family}/40 bg-{family}/10 text-{family}-dark). Unknown stays
// neutral — no color chip, per the prototype.
const VOTER_LIKELIHOOD_PILL_CLASSES: Record<VoterLikelihood, string> = {
  unknown: '',
  first_time: 'border-warning/40 bg-warning/10 text-warning-dark',
  unlikely: 'border-destructive/40 bg-destructive/10 text-destructive-dark',
  likely: 'border-info/40 bg-info/10 text-info-dark',
  super: 'border-success/40 bg-success/10 text-success-dark',
}

const SUPPORT_STATUS_OPTIONS: {
  value: SupportStatusRollup
  label: string
}[] = [
  { value: 'supporter', label: 'Supporter' },
  { value: 'non_supporter', label: 'Non-supporter' },
  { value: 'undecided', label: 'Undecided' },
  { value: 'refused', label: 'Refused' },
  { value: 'unknown', label: 'Unknown' },
]

// Supporter reads as the prototype's green chip; the remaining options are
// color-coded by the same read as the demographics Field they replace
// (non_supporter is the mirror-image negative of supporter; undecided/refused/
// unknown stay neutral — the prototype only specifies Supporter's color).
const SUPPORT_STATUS_PILL_CLASSES: Record<SupportStatusRollup, string> = {
  supporter: 'border-success/40 bg-success/10 text-success-dark',
  non_supporter:
    'border-destructive/40 bg-destructive/10 text-destructive-dark',
  undecided: '',
  refused: '',
  unknown: '',
}

const StatusField: React.FC<{
  label: string
  htmlFor?: string
  children: React.ReactNode
}> = ({ label, htmlFor, children }) => (
  <div className="flex flex-col gap-1">
    <label htmlFor={htmlFor} className="text-sm text-muted-foreground">
      {label}
    </label>
    {children}
  </div>
)

// Read-only — TCPA product decision (2026-07-28): a manual opt-in override on
// a texted STOP has no safe semantics, so this pill carries no menu
// affordance. Presentation matches the OptedInChip it replaces exactly.
const OptInStatusPill: React.FC<{ optedOutAt: string | null }> = ({
  optedOutAt,
}) => (
  <Badge
    variant="outline"
    shape="pill"
    className={
      optedOutAt
        ? 'w-fit border-destructive/40 bg-destructive/10 text-destructive-dark'
        : 'w-fit border-success/40 bg-success/10 text-success-dark'
    }
  >
    {optedOutAt ? 'Opted Out' : 'Opted In'}
  </Badge>
)

interface StatusRowProps {
  person: Person
  // Same Serve signal the political-party field / OptedInChip already gate
  // on (isElectedOfficial) — reused rather than threading a second prop, same
  // convention as PersonOverlay's showOptedInChip (ENG-10732).
  hidePoliticalParty: boolean
}

// The person-record status row (ENG-10836): Voter Likelihood + Support Status
// editable dropdowns and a read-only Opt In Status pill. Replaces the Win
// read-only Support Status Field and the name-adjacent OptedInChip. Mounted
// unconditionally by PersonOverlay (same self-gating convention as
// NotesSection) — self-gates on Win + CRM-on so Serve's page stays identical.
export default function StatusRow({
  person,
  hidePoliticalParty,
}: StatusRowProps): React.JSX.Element | null {
  // trackExposure=false: this surface reads the flag to decide whether to
  // render, it isn't the CRM treatment surface (ContactsPageGate is).
  const { enabled, ready } = useCrmEnabled()
  const orgSlug = useOrganization()?.slug
  const queryClient = useQueryClient()
  const { errorSnackbar } = useSnackbar()
  const personQueryKey = ['person', orgSlug, person.id]

  const voterLikelihood = person.voterLikelihood ?? 'unknown'
  const supportStatus = person.supportStatus ?? 'unknown'

  const applyOptimisticUpdate = (
    patch: Pick<Person, 'voterLikelihood'> | Pick<Person, 'supportStatus'>,
  ) => {
    queryClient.setQueryData<Person>(personQueryKey, (current) =>
      current ? { ...current, ...patch } : current,
    )
  }

  // Both mutations scope every cache write (optimistic, rollback, and
  // success-merge) to ONLY the single field they own — never the whole
  // Person object. The two dropdowns can be changed in quick succession
  // (voter_likelihood mutation still in flight when support_status is
  // clicked); a whole-object snapshot/restore or a whole-ContactStatuses
  // merge would clobber whichever field the OTHER mutation had already
  // committed in between. `context.fromValue` (captured from this
  // component's own prop-derived value at click time, not from the cache) is
  // both the rollback target and the analytics `from`.
  const voterLikelihoodMutation = useMutation<
    ContactStatuses,
    FetchError,
    VoterLikelihood,
    { fromValue: VoterLikelihood }
  >({
    mutationFn: (value) =>
      clientRequest('PATCH /v1/contacts/:personId/status', {
        personId: person.id,
        field: 'voter_likelihood',
        value,
      }).then((res) => res.data),
    onMutate: (value) => {
      const fromValue = voterLikelihood
      applyOptimisticUpdate({ voterLikelihood: value })
      return { fromValue }
    },
    onError: (_error, _value, context) => {
      if (context) {
        queryClient.setQueryData<Person>(personQueryKey, (current) =>
          current
            ? { ...current, voterLikelihood: context.fromValue }
            : current,
        )
      }
      errorSnackbar("Couldn't update Voter Likelihood. Please try again.")
    },
    onSuccess: (data, value, context) => {
      queryClient.setQueryData<Person>(personQueryKey, (current) =>
        current
          ? { ...current, voterLikelihood: data.voterLikelihood }
          : current,
      )
      queryClient.invalidateQueries({
        queryKey: ['contact-engagement', 'activities'],
      })
      trackEvent(EVENTS.VoterData.ContactStatusChanged, {
        field: 'voter_likelihood',
        from: context.fromValue,
        to: value,
      })
    },
  })

  const supportStatusMutation = useMutation<
    ContactStatuses,
    FetchError,
    SupportStatusRollup,
    { fromValue: SupportStatusRollup }
  >({
    mutationFn: (value) =>
      clientRequest('PATCH /v1/contacts/:personId/status', {
        personId: person.id,
        field: 'support_status',
        value,
      }).then((res) => res.data),
    onMutate: (value) => {
      const fromValue = supportStatus
      applyOptimisticUpdate({ supportStatus: value })
      return { fromValue }
    },
    onError: (_error, _value, context) => {
      if (context) {
        queryClient.setQueryData<Person>(personQueryKey, (current) =>
          current ? { ...current, supportStatus: context.fromValue } : current,
        )
      }
      errorSnackbar("Couldn't update Support Status. Please try again.")
    },
    onSuccess: (data, value, context) => {
      queryClient.setQueryData<Person>(personQueryKey, (current) =>
        current ? { ...current, supportStatus: data.supportStatus } : current,
      )
      queryClient.invalidateQueries({
        queryKey: ['contact-engagement', 'activities'],
      })
      trackEvent(EVENTS.VoterData.ContactStatusChanged, {
        field: 'support_status',
        from: context.fromValue,
        to: value,
      })
    },
  })

  const handleVoterLikelihoodChange = (value: string) => {
    if (value === voterLikelihood) return
    voterLikelihoodMutation.mutate(value as VoterLikelihood)
  }

  const handleSupportStatusChange = (value: string) => {
    if (value === supportStatus) return
    supportStatusMutation.mutate(value as SupportStatusRollup)
  }

  if (!ready || !enabled || hidePoliticalParty) return null

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6 mb-6">
      <StatusField label="Voter Likelihood" htmlFor="voter-likelihood-select">
        <Select
          value={voterLikelihood}
          onValueChange={handleVoterLikelihoodChange}
        >
          <SelectTrigger
            id="voter-likelihood-select"
            aria-label="Voter Likelihood"
            className={cn(
              'w-full',
              VOTER_LIKELIHOOD_PILL_CLASSES[voterLikelihood],
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[1400]">
            {VOTER_LIKELIHOOD_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </StatusField>

      <StatusField label="Support Status" htmlFor="support-status-select">
        <Select value={supportStatus} onValueChange={handleSupportStatusChange}>
          <SelectTrigger
            id="support-status-select"
            aria-label="Support Status"
            className={cn('w-full', SUPPORT_STATUS_PILL_CLASSES[supportStatus])}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[1400]">
            {SUPPORT_STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </StatusField>

      <StatusField label="Opt In Status">
        <OptInStatusPill optedOutAt={person.optedOutAt ?? null} />
      </StatusField>
    </div>
  )
}
