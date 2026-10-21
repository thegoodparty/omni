import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import { Button } from '@styleguide'
import type { ListProposal, ShowListMap } from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { useState } from 'react'
import { useOrganization } from '@shared/organization-picker'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useSnackbar } from 'helpers/useSnackbar'
import { ProPitchDialog } from 'app/dashboard/shared/membership/ProPitchDialog'
import {
  peopleCount,
  type CardMode,
} from 'app/dashboard/shared/agent-chat/cards/proposalPresentation'
import ChatListMap from './ChatListMap'

export type ChatListProposalPayload = ListProposal & { proposalKey: string }

// Whether this card's list exists yet. Read live rather than remembered, so a
// reloaded transcript, or the same conversation open in another tab, shows
// the list the card made instead of offering to make it again. A 404 is the
// ordinary "not pressed yet" answer, never an error.
export const listByProposalKeyQueryOptions = (
  orgSlug: string | undefined,
  proposalKey: string,
) =>
  queryOptions({
    queryKey: ['list-by-proposal-key', orgSlug, proposalKey],
    retry: false,
    enabled: Boolean(orgSlug),
    queryFn: async () => {
      try {
        const res = await clientRequest(
          'GET /v1/voters/voter-file/filter/by-proposal-key/:proposalKey',
          { proposalKey },
        )
        return res.data
      } catch (error) {
        if (error instanceof FetchError && error.status === 404) return null
        throw error
      }
    },
  })

const CardFrame = ({ children }: { children: React.ReactNode }) => (
  <div className="my-3 w-full overflow-hidden rounded-lg border">
    {children}
  </div>
)

interface ChatListProposalProps {
  proposal: ChatListProposalPayload
  // Campaign Manager is Win: voters and a Pro gate on saving.
  mode?: CardMode
  onRefineArea?: (list: ShowListMap) => void
  // The list now exists. The conversation has to be told, because the write
  // goes browser -> API and the model would otherwise answer the next
  // question about a list it thinks is still only an offer.
  onCreated: (list: ShowListMap) => void
}

// A list the agent offered, saved by a button instead of a typed "yes". Once
// it is saved the card IS the list: the same map card the agent would have
// shown, with its Draw shapes button, so there is no second step to ask for.
export default function ChatListProposal({
  proposal,
  mode = 'serve',
  onRefineArea,
  onCreated,
}: ChatListProposalProps) {
  const orgSlug = useOrganization()?.slug
  const [campaign] = useCampaign()
  const [pitchOpen, setPitchOpen] = useState(false)
  const queryClient = useQueryClient()
  const { errorSnackbar } = useSnackbar()
  const existing = useQuery(
    listByProposalKeyQueryOptions(orgSlug, proposal.proposalKey),
  )

  const create = useMutation({
    // The key makes a second press, or a press racing a reload, return the
    // list the first one made rather than a twin.
    mutationFn: () =>
      clientRequest('POST /v1/voters/voter-file/filter', {
        ...proposal.filters,
        name: proposal.name,
        proposalKey: proposal.proposalKey,
      }).then((res) => res.data),
    onSuccess: async (created) => {
      queryClient.setQueryData(
        listByProposalKeyQueryOptions(orgSlug, proposal.proposalKey).queryKey,
        created,
      )
      await queryClient.invalidateQueries({
        queryKey: ['custom-segments', orgSlug],
      })
      onCreated({ listId: created.id, name: created.name ?? proposal.name })
    },
    onError: () => errorSnackbar('Failed to create list'),
  })

  if (existing.data) {
    return (
      <ChatListMap
        listId={existing.data.id}
        name={existing.data.name ?? proposal.name}
        onRefineArea={onRefineArea}
        mode={mode}
      />
    )
  }

  return (
    <CardFrame>
      <div className="flex flex-col gap-1 px-3 py-3">
        <span className="text-sm font-semibold">{proposal.name}</span>
        <span className="text-sm text-muted-foreground">
          {proposal.summary}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
        <span className="text-xs text-muted-foreground">
          {peopleCount(proposal.count, mode)}
        </span>
        {/* Held back until the lookup answers: a card whose list already
            exists must never offer to make it again, even for a frame. On
            Win it also waits for the campaign the Pro gate reads, since the
            save route itself does not refuse a free campaign. */}
        {existing.isPending || (mode === 'win' && !campaign) ? null : (
          <Button
            type="button"
            size="small"
            loading={create.isPending}
            onClick={() =>
              mode === 'win' && campaign && !campaign.isPro
                ? setPitchOpen(true)
                : create.mutate()
            }
          >
            Create list
          </Button>
        )}
      </div>
      {mode === 'win' && campaign ? (
        <ProPitchDialog
          open={pitchOpen}
          onOpenChange={setPitchOpen}
          source="campaign_manager"
          channel="voter-data"
        />
      ) : null}
    </CardFrame>
  )
}
