import { Container, Box, Separator } from '@radix-ui/themes'
import { stubbedUserHeader } from '@/data/stubbed-user'
import { UserPageHeader } from '../components/UserPageHeader'
import { TabNavigation } from '../components/TabNavigation'
import { ProtectedContent } from '@/components/ProtectedContent'
import { PERMISSIONS } from '@/lib/permissions'

interface EditLayoutProps {
  children: React.ReactNode
  params: Promise<{ id: string }>
}

export default async function EditLayout({
  children,
  params,
}: EditLayoutProps) {
  const { id } = await params
  // TODO: Replace stubbed data with API call using id
  void id
  const headerData = stubbedUserHeader

  return (
    <ProtectedContent requiredPermission={PERMISSIONS.WRITE_USERS}>
      <Container size="4">
        <Box mb="4">
          <UserPageHeader user={headerData} isEditMode />
        </Box>

        <TabNavigation userId={id} isEditMode />

        <Separator size="4" my="4" />

        {children}
      </Container>
    </ProtectedContent>
  )
}
