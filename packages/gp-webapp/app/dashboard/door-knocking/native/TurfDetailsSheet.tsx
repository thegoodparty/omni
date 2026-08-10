'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import { DoorKnockingTurf } from '@goodparty_org/contracts'
import { Button, IconButton, Trash2Icon, XMarkIcon } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { useSnackbar } from 'helpers/useSnackbar'
import { ConfirmDeleteDialog } from 'app/dashboard/shared/ConfirmDeleteDialog'
import filterSections from 'app/dashboard/contacts/[[...attr]]/components/configs/filters.config'
import { LANGUAGE_KEY_TO_CODE } from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import {
  routeQueryOptions,
  savedListsQueryOptions,
  turfsQueryOptions,
} from './turfQueries'
import type { PolygonStats } from './filterEngine'

// gp-api refuses to delete a knocked turf: doorKnockingTurf.delete runs
// assertNotLocked first, and lockedness IS the frozen route row, so a turf
// with logged knocks 409s. The affordance follows that rule rather than
// duplicating it — and the 409 is still handled, since a teammate can knock
// the turf while this sheet is open.
const LOCKED_TURF_MESSAGE =
  'This list has already been knocked, so its route is frozen and it can no longer be deleted.'

// option key -> pill label, straight from the sections config the create
// flow renders, so Details always speaks the same vocabulary.
const OPTION_LABELS: Record<string, string> = Object.fromEntries(
  filterSections.flatMap((section) =>
    section.fields.flatMap((field) =>
      field.options.map((option) => [option.key, option.label]),
    ),
  ),
)

const formatDuration = (seconds: number): string => {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg border border-border p-3">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-sm font-semibold">{value}</p>
  </div>
)

interface TurfDetailsSheetProps {
  turf: DoorKnockingTurf
  // Doors/voters inside the turf polygon, computed by the page from the
  // full (unfiltered) pack.
  areaStats: PolygonStats | null
  onClose: () => void
  // The page holds its own references to this turf (map scope, camera focus),
  // which would otherwise keep masking the map to a list that no longer
  // exists.
  onDeleted: (turf: DoorKnockingTurf) => void
}

export default function TurfDetailsSheet({
  turf,
  areaStats,
  onClose,
  onDeleted,
}: TurfDetailsSheetProps) {
  const queryClient = useQueryClient()
  const { successSnackbar } = useSnackbar()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const deleteTurf = useMutation({
    mutationFn: () =>
      clientRequest('DELETE /v1/door-knocking/turfs/:id', {
        id: String(turf.id),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: turfsQueryOptions.queryKey,
      })
      successSnackbar('List deleted')
      setConfirmOpen(false)
      onDeleted(turf)
    },
    onError: async (error) => {
      if (error instanceof FetchError && error.status === 409) {
        // Someone knocked it while this sheet was open. Refetch so `locked`
        // catches up and the affordance disappears behind the user.
        setDeleteError(LOCKED_TURF_MESSAGE)
        await queryClient.invalidateQueries({
          queryKey: turfsQueryOptions.queryKey,
        })
        return
      }
      setDeleteError('The list could not be deleted. Try again.')
    },
  })
  const routeQuery = useQuery({
    ...routeQueryOptions(turf.id),
    enabled: turf.locked,
  })
  const listsQuery = useQuery(savedListsQueryOptions)
  const filter = listsQuery.data?.find(
    (list) => list.id === turf.voterFileFilterId,
  )
  // Language selections persist as codes ('en'), not booleans — re-expand
  // them to their option labels like the boolean keys.
  const languageLabels = (
    (filter?.languageCodes as string[] | undefined) ?? []
  ).flatMap((code) => {
    const key = Object.entries(LANGUAGE_KEY_TO_CODE).find(
      ([, candidate]) => candidate === code,
    )?.[0]
    const label = key ? OPTION_LABELS[key] : undefined
    return label ? [label] : []
  })
  const appliedFilterLabels = filter
    ? Object.entries(OPTION_LABELS)
        .filter(([key]) => filter[key] === true)
        .map(([, label]) => label)
        .concat((filter.incomeRanges as string[] | undefined) ?? [])
        .concat(languageLabels)
    : []

  const route = routeQuery.data
  const targets =
    route?.stops.flatMap((stop) =>
      stop.addresses.flatMap((address) => address.targets),
    ) ?? []
  const reached = targets.filter(
    (target) => target.knockStatus !== 'unknown',
  ).length

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-background">
      <div className="border-b border-border px-6 py-4">
        <div className="mx-auto flex w-full max-w-2xl items-start gap-3">
          <span
            className="mt-1.5 h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: turf.color }}
          />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold">{turf.name}</h2>
            <p className="text-sm text-muted-foreground">
              Overview of this list, its route, and applied filters.
            </p>
          </div>
          {!turf.locked && (
            <Button
              size="small"
              variant="outline"
              // Named for the turf so it doesn't collide with the confirm
              // dialog's own "Delete", for screen readers and tests alike.
              aria-label={`Delete ${turf.name}`}
              className="shrink-0 text-destructive hover:bg-destructive/10"
              onClick={() => {
                setDeleteError(null)
                setConfirmOpen(true)
              }}
            >
              <Trash2Icon size={14} />
              Delete
            </Button>
          )}
          <IconButton aria-label="Close details" onClick={onClose}>
            <XMarkIcon size={18} />
          </IconButton>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-info">
              Overview
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <Stat
                label="Households"
                value={(
                  route?.route.stopCount ??
                  areaStats?.stops ??
                  0
                ).toLocaleString()}
              />
              <Stat
                label="People"
                value={(targets.length > 0
                  ? targets.length
                  : (areaStats?.people ?? 0)
                ).toLocaleString()}
              />
              <Stat
                label="Estimated time"
                value={
                  route
                    ? formatDuration(route.route.totalSeconds)
                    : 'Not knocked yet'
                }
              />
              <Stat
                label="Route type"
                value={
                  route
                    ? route.route.mode === 'walk'
                      ? `Walk route${route.route.loop ? ' · loop' : ''}`
                      : `Drive route${route.route.loop ? ' · loop' : ''}`
                    : 'Not knocked yet'
                }
              />
              <Stat
                label="Created"
                value={new Date(turf.createdAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              />
              <Stat
                label="Progress"
                value={
                  route
                    ? `${reached} of ${targets.length} · ${
                        targets.length > 0
                          ? Math.round((reached / targets.length) * 100)
                          : 0
                      }%`
                    : 'Not knocked yet'
                }
              />
            </div>
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-info">
              Applied filters
            </h3>
            {appliedFilterLabels.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No filters applied — this list targets all contacts.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {/* Labels repeat across fields — 'Unknown' is an option on 11 of
                    them — so the label alone isn't a stable key. */}
                {appliedFilterLabels.map((label, index) => (
                  <span
                    key={`${label}-${index}`}
                    className="rounded-full border border-border px-2.5 py-1 text-xs"
                  >
                    {label}
                  </span>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
      <ConfirmDeleteDialog
        open={confirmOpen}
        onOpenChange={(next) => {
          setConfirmOpen(next)
          if (!next) setDeleteError(null)
        }}
        title={`Delete ${turf.name}?`}
        description="The drawn area and its filters are removed for good. The saved list stays in Contacts, and no logged knocks are affected."
        onConfirm={() => deleteTurf.mutate()}
        confirming={deleteTurf.isPending}
        errorMessage={deleteError}
      />
    </div>
  )
}
