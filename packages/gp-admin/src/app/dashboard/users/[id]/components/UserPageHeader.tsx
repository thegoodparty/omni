'use client'

import { Flex, Heading, Avatar, Button } from '@radix-ui/themes'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { HiPencil, HiArrowLeft } from 'react-icons/hi'
import { ProtectedContent } from '@/components/ProtectedContent'
import { PERMISSIONS } from '@/lib/permissions'
import { useUser } from '../context/UserContext'

interface UserPageHeaderProps {
  isEditMode?: boolean
}

export function UserPageHeader({ isEditMode = false }: UserPageHeaderProps) {
  const { id, firstName, lastName, avatar } = useUser()
  const pathname = usePathname()

  const basePath = `/dashboard/users/${id}`
  const subRoute = isEditMode
    ? pathname.replace(`${basePath}/edit`, '')
    : pathname.replace(basePath, '')

  return (
    <Flex gap="5" align="center" justify="between">
      <Flex gap="4" align="center">
        {isEditMode && (
          <Link
            href={`${basePath}${subRoute}`}
            aria-label="Back to user"
            className="text-[var(--gray-11)] hover:text-[var(--gray-12)]"
          >
            <HiArrowLeft className="w-5 h-5" />
          </Link>
        )}
        <Avatar
          size="6"
          src={avatar ?? undefined}
          fallback={firstName?.[0] ?? 'U'}
          radius="medium"
        />
        <Heading size="6">
          {`${isEditMode ? 'Edit: ' : ''}${firstName} ${lastName}`}
        </Heading>
      </Flex>
      {!isEditMode && (
        <ProtectedContent
          requiredPermission={PERMISSIONS.WRITE_USERS}
          hideWhenUnauthorized
        >
          <Button asChild>
            <Link href={`${basePath}/edit${subRoute}`}>
              <HiPencil className="w-4 h-4" />
              Edit
            </Link>
          </Button>
        </ProtectedContent>
      )}
    </Flex>
  )
}
