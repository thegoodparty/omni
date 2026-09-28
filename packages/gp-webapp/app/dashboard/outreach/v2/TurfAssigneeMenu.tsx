import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Button,
  ChevronDownIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import { useTeamAccountsFlag } from '@shared/experiments/teamAccountsFlag'
import { useSnackbar } from 'helpers/useSnackbar'
import { teamQueryKey } from 'app/dashboard/team/team.util'
import { useTeamOptions } from 'app/dashboard/door-knocking/native/useTeamOptions'
import { volunteerAssignmentsQueryKey } from 'app/volunteer/components/AssignmentsPage'
import { outreachAssigneesQueryKey } from './OutreachAssigneesSection'

interface TurfAssigneeMenuProps {
  // The TURF's own envelope, never the campaign anchor's. A canvasser walks
  // a turf; the campaign is not a thing anybody can be handed.
  outreachId: number
  // Radix portals this menu to the body, so dismissing it is a click
  // OUTSIDE the drawer this row sits in — which closed the drawer with it.
  // The same seam the row's confirm dialog already reports through: the row
  // says an overlay is up and the drawer decides what that means.
  onMenuOpenChange?: (open: boolean) => void
}

// Who walks this turf, on the campaign's details view, as the control that
// changes it.
//
// **Single-select, against a many-to-one API.** `POST
// /v1/outreach/:id/assignments` stores a LIST, and the campaign-level
// section this replaces is a modal that can add several people at once.
// A turf is one walk down one street, so the question here is "who walks
// this" and the answer is one name — the same question the drawing panel
// asks while the turf is being cut. Picking a name therefore REPLACES
// whoever is there rather than adding to them, and a turf that somehow
// holds two assignees shows the first and collapses to one on the next
// pick. Multi-assignee is a phone-banking shape, not a turf's.
//
// Flag-gated exactly as the section it replaces was: an org without team
// accounts has no roster to pick from and saw no assign control here
// before.
export const TurfAssigneeMenu = ({
  outreachId,
  onMenuOpenChange,
}: TurfAssigneeMenuProps) => {
  const { enabled: flagEnabled } = useTeamAccountsFlag(false)
  const organization = useOrganization()
  const orgSlug = organization?.slug
  const queryClient = useQueryClient()
  const { successSnackbar, errorSnackbar } = useSnackbar()
  const team = useTeamOptions(flagEnabled ? orgSlug : undefined)

  const assigneesQuery = useQuery({
    queryKey: outreachAssigneesQueryKey(outreachId),
    queryFn: () =>
      clientRequest('GET /v1/outreach/:id/assignments', {
        id: String(outreachId),
      }).then((res) => res.data.assignees),
    enabled: flagEnabled,
  })
  const current = assigneesQuery.data?.[0] ?? null

  const invalidateAll = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: outreachAssigneesQueryKey(outreachId),
      }),
      queryClient.invalidateQueries({ queryKey: teamQueryKey(orgSlug) }),
      queryClient.invalidateQueries({
        queryKey: volunteerAssignmentsQueryKey(orgSlug),
      }),
    ])

  // One mutation for the whole gesture, because "assign" here means "this
  // person instead of that one": the old assignee has to go or the turf ends
  // up with two, which is the state this control cannot show. Sequential and
  // remove-first, so a failed add cannot leave the turf assigned to both.
  const reassign = useMutation({
    mutationFn: async (userId: number | null) => {
      if (current && current.userId !== userId) {
        await clientRequest('DELETE /v1/outreach/:id/assignments/:userId', {
          id: String(outreachId),
          userId: String(current.userId),
        })
      }
      if (userId !== null && current?.userId !== userId) {
        await clientRequest('POST /v1/outreach/:id/assignments', {
          id: String(outreachId),
          assigneeUserId: userId,
        })
      }
    },
    onSuccess: async (_data, userId) => {
      await invalidateAll()
      successSnackbar(userId === null ? 'Unassigned' : 'Assigned')
    },
    onError: () =>
      errorSnackbar("Couldn't change who walks this turf. Please try again."),
  })

  // Hidden rather than disabled on an org with nobody on it, the same rule
  // the drawing panel's assignee control follows: a control whose only
  // outcome is finding out there is nobody to pick is worse than none.
  if (!flagEnabled || team.length === 0) return null

  const label =
    team.find((option) => option.userId === current?.userId)?.label ??
    current?.name ??
    'Unassigned'

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) {
          onMenuOpenChange?.(true)
          return
        }
        // Held for a tick on the way DOWN, and that is the whole fix.
        // Dismissing the menu with a click outside it is ONE pointer
        // event: Radix closes the menu, React flushes that discrete
        // update synchronously, and the drawer's own outside handler then
        // runs against a flag that has already gone false — so the drawer
        // closed with the menu. Clearing it after the event lets the
        // drawer see that an overlay was up, refuse that click, and stay.
        // The next click outside closes the drawer, which is what it
        // should have taken all along.
        window.setTimeout(() => onMenuOpenChange?.(false), 0)
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="small"
          disabled={reassign.isPending}
          // The name IS the control, the way the turf's own name is on the
          // drawing surface: no field, no border, just the chevron saying
          // it can change. Muted while nobody is assigned, because then it
          // is a prompt rather than a name.
          className={`h-auto shrink-0 px-1 py-0 text-sm font-normal ${
            current ? 'text-foreground' : 'text-muted-foreground'
          }`}
        >
          <span className="max-w-[10rem] truncate">{label}</span>
          <ChevronDownIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem]">
        <DropdownMenuLabel>Who walks this turf</DropdownMenuLabel>
        {team.map((option) => (
          <DropdownMenuItem
            key={option.userId}
            onSelect={() => reassign.mutate(option.userId)}
          >
            <span className="truncate">{option.label}</span>
          </DropdownMenuItem>
        ))}
        {current && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => reassign.mutate(null)}>
              Unassign
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
