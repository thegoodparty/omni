import { Flex, Heading, Avatar, Button } from '@radix-ui/themes'
import Link from 'next/link'
import { HiPencil, HiArrowLeft } from 'react-icons/hi'
import { ProtectedContent } from '@/components/ProtectedContent'
import { PERMISSIONS } from '@/lib/permissions'
import type { UserHeaderData } from '../types/user'

interface UserPageHeaderProps {
  user: UserHeaderData
  isEditMode?: boolean
}

export function UserPageHeader({
  user,
  isEditMode = false,
}: UserPageHeaderProps) {
  return (
    <Flex gap="5" align="center" justify="between">
      <Flex gap="4" align="center">
        {isEditMode && (
          <Link
            href={`/dashboard/users/${user.id}`}
            className="text-[var(--gray-11)] hover:text-[var(--gray-12)]"
          >
            <HiArrowLeft className="w-5 h-5" />
          </Link>
        )}
        <Avatar
          size="6"
          src={user.avatar ?? undefined}
          fallback={user.name?.[0] ?? 'U'}
          radius="medium"
        />
        <Heading size="6">
          {isEditMode ? `Edit: ${user.name}` : user.name}
        </Heading>
      </Flex>
      {!isEditMode && (
        <ProtectedContent
          requiredPermission={PERMISSIONS.WRITE_USERS}
          hideWhenUnauthorized
        >
          <Button asChild>
            <Link href={`/dashboard/users/${user.id}/edit`}>
              <HiPencil className="w-4 h-4" />
              Edit
            </Link>
          </Button>
        </ProtectedContent>
      )}
    </Flex>
  )
}
