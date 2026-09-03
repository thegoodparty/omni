'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TeamMember, PendingInvite } from 'gpApi/api-endpoints'
import {
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@styleguide'
import {
  CircleHelpIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Trash2Icon,
} from '@styleguide/components/ui/icons'
import DashboardLayout from 'app/dashboard/shared/DashboardLayout'
import { NAV_LABELS } from 'app/dashboard/shared/navLabels'
import { clientRequest } from 'gpApi/typed-request'
import {
  useOrganization,
  useOrganizationRole,
} from '@shared/organization-picker'
import { useSnackbar } from 'helpers/useSnackbar'
import InviteMemberDialog from './InviteMemberDialog'

// Only 'owner' and 'campaignAdmin' can appear today: invites (and therefore
// every membership row) are pinned to campaignAdmin in Phase 1
// (InviteTeamMemberDto), and 'owner' is never a membership row, only the
// synthetic first row listTeam adds. 'volunteer' is kept here anyway — the
// OrganizationRole/TeamInviteRole types both allow it, and an unmapped role
// would otherwise render as a raw enum value the moment Phase 1.5 ships it.
const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  campaignAdmin: 'Campaign Manager',
  volunteer: 'Volunteer',
}

export const teamQueryKey = (orgSlug: string | undefined) => ['team', orgSlug]

const formatName = (name: string | null, email: string): string =>
  name && name.trim().length > 0 ? name : email

const TeamPage = (): React.JSX.Element => {
  const organization = useOrganization()
  const role = useOrganizationRole()
  const isOwner = role === 'owner'
  const orgSlug = organization?.slug
  const queryClient = useQueryClient()
  const { successSnackbar, errorSnackbar } = useSnackbar()
  const [inviteOpen, setInviteOpen] = useState(false)

  const { data, isLoading, isError } = useQuery({
    queryKey: teamQueryKey(orgSlug),
    queryFn: () =>
      clientRequest('GET /v1/organizations/team', {}).then((res) => res.data),
    enabled: !!orgSlug,
  })

  const invalidateTeam = () =>
    queryClient.invalidateQueries({ queryKey: teamQueryKey(orgSlug) })

  const revokeMutation = useMutation({
    mutationFn: (id: string) =>
      clientRequest('DELETE /v1/organizations/team/invites/:id', { id }),
    onSuccess: async () => {
      successSnackbar('Invitation revoked')
      await invalidateTeam()
    },
    onError: () => errorSnackbar('Failed to revoke the invitation'),
  })

  const removeMutation = useMutation({
    mutationFn: (userId: number) =>
      clientRequest('DELETE /v1/organizations/team/members/:userId', {
        userId: String(userId),
      }),
    onSuccess: async () => {
      successSnackbar('Member removed')
      await invalidateTeam()
    },
    onError: () => errorSnackbar('Failed to remove the member'),
  })

  const members: TeamMember[] = data?.members ?? []
  const pendingInvites: PendingInvite[] = data?.pendingInvites ?? []

  return (
    <DashboardLayout
      pathname="/dashboard/team"
      navHeader={{ icon: 'users', label: NAV_LABELS.team }}
    >
      <div className="w-full bg-muted px-4 py-6 pb-20 sm:px-8 md:px-16">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4">
          <Card className="flex flex-row items-start gap-3 p-6">
            <CircleHelpIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <p className="m-0 text-sm text-muted-foreground">
              Your Campaign Manager can run everything except your billing and
              account settings.
            </p>
          </Card>

          <Card className="flex flex-col gap-4 p-6">
            <div className="flex items-center justify-between gap-4">
              <h2 className="m-0 text-xl font-semibold text-foreground">
                {isLoading ? (
                  <Skeleton className="h-6 w-40" />
                ) : (
                  `${members.length} ${members.length === 1 ? 'person' : 'people'} on this campaign`
                )}
              </h2>
              <Button onClick={() => setInviteOpen(true)}>
                <PlusIcon />
                Invite
              </Button>
            </div>

            {isError ? (
              <p className="m-0 text-sm text-destructive">
                Couldn’t load your team. Try refreshing the page.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={4}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ) : (
                    members.map((member) => (
                      <TableRow key={member.userId}>
                        <TableCell>
                          {formatName(member.name, member.email)}
                        </TableCell>
                        <TableCell>
                          {ROLE_LABELS[member.role] ?? member.role}
                        </TableCell>
                        <TableCell>{member.email}</TableCell>
                        <TableCell>
                          {isOwner && member.role !== 'owner' && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <IconButton
                                  variant="ghost"
                                  size="small"
                                  aria-label={`Manage ${formatName(member.name, member.email)}`}
                                >
                                  <MoreHorizontalIcon />
                                </IconButton>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  variant="destructive"
                                  disabled={removeMutation.isPending}
                                  onClick={() =>
                                    removeMutation.mutate(member.userId)
                                  }
                                >
                                  <Trash2Icon />
                                  Remove from team
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </Card>

          <Card className="flex flex-col gap-4 p-6">
            <h2 className="m-0 text-xl font-semibold text-foreground">
              Pending invites
            </h2>
            {!isLoading && pendingInvites.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">
                No pending invites.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={4}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ) : (
                    pendingInvites.map((invite) => (
                      <TableRow key={invite.id}>
                        <TableCell>{invite.name}</TableCell>
                        <TableCell>
                          {ROLE_LABELS[invite.role] ?? invite.role}
                        </TableCell>
                        <TableCell>{invite.email}</TableCell>
                        <TableCell>
                          <IconButton
                            variant="ghost"
                            size="small"
                            aria-label={`Revoke invite for ${invite.email}`}
                            disabled={revokeMutation.isPending}
                            onClick={() => revokeMutation.mutate(invite.id)}
                          >
                            <Trash2Icon />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>
      </div>

      <InviteMemberDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInvited={invalidateTeam}
      />
    </DashboardLayout>
  )
}

export default TeamPage
