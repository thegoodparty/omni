'use server'

import { auth, clerkClient } from '@clerk/nextjs/server'
import { OrganizationMembership, OrganizationInvitation } from '@clerk/backend'
import { ROLES, PERMISSIONS } from '@/lib/permissions'

type ActionResult<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string }

type ActionResultWithData<T> =
  | { success: true; data: T }
  | { success: false; error: string; data: T }

/**
 * Invite a new member to the current organization
 */
export async function inviteMember(
  emailAddress: string,
  role: string = ROLES.READ_ONLY
): Promise<ActionResult<{ invitationId: string }>> {
  const { orgId, userId, has } = await auth()

  if (!has?.({ permission: PERMISSIONS.MANAGE_INVITES })) {
    return {
      success: false,
      error: 'Unauthorized: Missing manage_invites permission',
    }
  }

  if (!orgId) {
    return { success: false, error: 'No active organization' }
  }

  if (!userId) {
    return { success: false, error: 'Not authenticated' }
  }

  try {
    const client = await clerkClient()

    const invitation = await client.organizations.createOrganizationInvitation({
      organizationId: orgId,
      emailAddress,
      role,
      inviterUserId: userId,
    })

    return {
      success: true,
      data: { invitationId: invitation.id },
    }
  } catch (error) {
    console.error('Failed to invite member:', error)
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'Failed to send invitation',
    }
  }
}

/**
 * Revoke a pending invitation
 */
export async function revokeInvitation(
  invitationId: string
): Promise<ActionResult> {
  const { orgId, userId, has } = await auth()

  if (!has?.({ permission: PERMISSIONS.MANAGE_INVITES })) {
    return {
      success: false,
      error: 'Unauthorized: Missing manage_invites permission',
    }
  }

  if (!orgId) {
    return { success: false, error: 'No active organization' }
  }

  if (!userId) {
    return { success: false, error: 'Not authenticated' }
  }

  try {
    const client = await clerkClient()

    await client.organizations.revokeOrganizationInvitation({
      organizationId: orgId,
      invitationId,
      requestingUserId: userId,
    })

    return { success: true }
  } catch (error) {
    console.error('Failed to revoke invitation:', error)
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'Failed to revoke invitation',
    }
  }
}

/**
 * Get all members of the current organization
 */
export async function getOrganizationMembers(): Promise<
  ActionResultWithData<OrganizationMembership[]>
> {
  const { orgId } = await auth()

  if (!orgId) {
    return { success: false, error: 'No active organization', data: [] }
  }

  try {
    const client = await clerkClient()

    const memberships =
      await client.organizations.getOrganizationMembershipList({
        organizationId: orgId,
      })

    return {
      success: true,
      data: memberships.data,
    }
  } catch (error) {
    console.error('Failed to get organization members:', error)
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Failed to get organization members',
      data: [],
    }
  }
}

/**
 * Get pending invitations for the current organization
 */
export async function getPendingInvitations(): Promise<
  ActionResultWithData<OrganizationInvitation[]>
> {
  const { orgId, has } = await auth()

  if (!has?.({ permission: PERMISSIONS.MANAGE_INVITES })) {
    return {
      success: false,
      error: 'Unauthorized: Missing manage_invites permission',
      data: [],
    }
  }

  if (!orgId) {
    return { success: false, error: 'No active organization', data: [] }
  }

  try {
    const client = await clerkClient()

    const invitations =
      await client.organizations.getOrganizationInvitationList({
        organizationId: orgId,
        status: ['pending'],
      })

    return {
      success: true,
      data: invitations.data,
    }
  } catch (error) {
    console.error('Failed to get pending invitations:', error)
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Failed to get pending invitations',
      data: [],
    }
  }
}

/**
 * Update a member's role in the organization
 */
export async function updateMemberRole(
  membershipId: string,
  newRole: string
): Promise<ActionResult> {
  const { orgId, has } = await auth()

  if (!has?.({ permission: PERMISSIONS.MANAGE_INVITES })) {
    return {
      success: false,
      error: 'Unauthorized: Missing manage_invites permission',
    }
  }

  if (!orgId) {
    return { success: false, error: 'No active organization' }
  }

  try {
    const client = await clerkClient()

    await client.organizations.updateOrganizationMembership({
      organizationId: orgId,
      userId: membershipId,
      role: newRole,
    })

    return { success: true }
  } catch (error) {
    console.error('Failed to update member role:', error)
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'Failed to update member role',
    }
  }
}

/**
 * Remove a member from the organization
 */
export async function removeMember(userId: string): Promise<ActionResult> {
  const { orgId, has } = await auth()

  if (!has?.({ permission: PERMISSIONS.MANAGE_INVITES })) {
    return {
      success: false,
      error: 'Unauthorized: Missing manage_invites permission',
    }
  }

  if (!orgId) {
    return { success: false, error: 'No active organization' }
  }

  try {
    const client = await clerkClient()

    await client.organizations.deleteOrganizationMembership({
      organizationId: orgId,
      userId,
    })

    return { success: true }
  } catch (error) {
    console.error('Failed to remove member:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to remove member',
    }
  }
}
