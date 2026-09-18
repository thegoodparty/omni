import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ChevronRightIcon, cn, DrawerTitle } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import {
  OUTREACH_OPTIONS,
  OUTREACH_TYPES,
} from 'app/dashboard/outreach/constants'
import { CHANNEL_META } from 'app/dashboard/outreach/v2/channelMeta'
import { getContactsLabels } from '../../../../shared/contactsLabels'
import { useContactsTable } from '../../ContactsTableProvider'
import { recommendedListDetailQueryOptions } from '../../recommended/recommendedListDetail.query'
import CrmSheet from '../CrmSheet'
import { ALL_SEGMENTS } from '../constants'
import type { ListDetailReachability } from '../contacts-types'
import {
  channelPickerHref,
  type ChannelPickerChannel,
  type ChannelPickerTarget,
} from './channelPickerHref.util'

interface ChannelPickerSheetProps {
  target: ChannelPickerTarget | null
  onClose: () => void
}

// Which list-detail reachability leaf each channel reads. Social has no
// audience and no leaf.
const REACHABILITY_KEY: Record<
  Exclude<ChannelPickerChannel, 'socialMedia'>,
  keyof ListDetailReachability
> = {
  text: 'sms',
  robocall: 'robocall',
  phoneBanking: 'phoneBanking',
  doorKnocking: 'doorKnocking',
}

const CHANNELS: ChannelPickerChannel[] = [
  'text',
  'robocall',
  'phoneBanking',
  'doorKnocking',
  'socialMedia',
]

// The per-contact price the flows charge, from the one source the hub tiles
// and the flows already read. Zero for the volunteer-run channels.
const pricePerContact = (channel: ChannelPickerChannel): number =>
  OUTREACH_OPTIONS.find((option) => option.type === OUTREACH_TYPES[channel])
    ?.cost ?? 0

// Integer tenth-cents, rounded to the cent, so the figure here is the figure
// gp-api's pricing utils produce for the flow's own card — float math on
// 16,449 x 0.035 lands a cent short of what checkout charges.
const costLabel = (reach: number, price: number): string => {
  const cents = Math.round((reach * Math.round(price * 1000)) / 10)
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

// The prototype's "Choose a channel" drawer: the list name and size in the
// header, one row per channel with how many of the list it can reach and
// what that costs. Picking a row links into the hub with that flow named,
// carrying the audience — the hub is the only thing that mounts a flow.
export default function ChannelPickerSheet({
  target,
  onClose,
}: ChannelPickerSheetProps) {
  const orgSlug = useOrganization()?.slug
  const { canUseProFeatures, isWinContext, voterDataUnavailable } =
    useContactsTable()
  const labels = getContactsLabels(isWinContext)
  const enabled = target !== null && canUseProFeatures && !voterDataUnavailable

  // Same keys the detail sheets and the list rows use, so a picker opened
  // from a row whose count already resolved renders its reach at once.
  const listDetailQuery = useQuery({
    queryKey: [
      'list-detail',
      orgSlug,
      target?.kind === 'list' ? target.segment.id : ALL_SEGMENTS,
    ],
    queryFn: () =>
      clientRequest(
        'GET /v1/contacts/list-detail',
        target?.kind === 'list' ? { segment: target.segment.id } : {},
      ).then((res) => res.data),
    enabled: enabled && target.kind !== 'recommended',
  })
  const recommendedDetailQuery = useQuery({
    ...recommendedListDetailQueryOptions(
      orgSlug,
      target?.kind === 'recommended'
        ? target.recommendation
        : {
            variant: 'introNeverIded',
            intent: 'introduce',
            filter: {},
            count: 0,
            copy: { title: '', criteriaSummary: '' },
            existingFilterId: null,
          },
    ),
    enabled: enabled && target.kind === 'recommended',
  })
  const detailQuery =
    target?.kind === 'recommended' ? recommendedDetailQuery : listDetailQuery

  const name =
    target?.kind === 'list'
      ? target.segment.name || 'Untitled list'
      : target?.kind === 'recommended'
        ? target.recommendation.copy.title
        : labels.allContactsTitle
  const count =
    target?.kind === 'recommended'
      ? target.recommendation.count
      : detailQuery.data?.demographics.people
  const reachability = detailQuery.data?.reachability

  const reachOf = (channel: ChannelPickerChannel): number | null => {
    if (channel === 'socialMedia') return null
    const value = reachability?.[REACHABILITY_KEY[channel]]
    return typeof value === 'number' ? value : null
  }

  // The prototype orders rows by how many of the list each channel reaches;
  // social has no audience and always sits last. Left in channel order until
  // the counts land, so the rows do not reshuffle under the pointer.
  const rows = reachability
    ? [...CHANNELS].sort((a, b) => (reachOf(b) ?? -1) - (reachOf(a) ?? -1))
    : CHANNELS

  return (
    <CrmSheet
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      header={
        <div className="flex flex-col gap-1">
          <DrawerTitle className="text-base font-semibold">
            Choose a channel
          </DrawerTitle>
          <p className="text-sm text-muted-foreground">
            {count !== undefined
              ? `${name} · ${count.toLocaleString()} voters`
              : name}
          </p>
        </div>
      }
    >
      {target && (
        <div className="flex flex-col gap-3">
          {rows.map((channel) => {
            const meta = CHANNEL_META[OUTREACH_TYPES[channel]]
            const reach = reachOf(channel)
            const price = pricePerContact(channel)
            const detail =
              channel === 'socialMedia'
                ? 'Free'
                : detailQuery.isError || (reachability && reach === null)
                  ? 'Unavailable'
                  : reach === null
                    ? 'Counting…'
                    : `${reach.toLocaleString()} reachable · ${
                        price > 0 ? costLabel(reach, price) : 'Free'
                      }`
            return (
              <Link
                key={channel}
                href={channelPickerHref(channel, target)}
                className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 no-underline shadow-xs transition-colors hover:border-primary/50"
              >
                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full text-foreground [&>svg]:size-4',
                    meta.iconTint,
                  )}
                >
                  {meta.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold">{meta.label}</h3>
                  <span className="block truncate text-xs text-muted-foreground">
                    {detail}
                  </span>
                </span>
                <ChevronRightIcon
                  className="size-5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              </Link>
            )
          })}
        </div>
      )}
    </CrmSheet>
  )
}
