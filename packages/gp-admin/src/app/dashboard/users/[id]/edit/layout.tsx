import { Container, Box, Separator } from '@radix-ui/themes'
import { NavigationGuardProvider } from 'next-navigation-guard'
import { UserPageHeader } from '../components/UserPageHeader'
import { TabNavigation } from '../components/TabNavigation'
import { ProtectedContent } from '@/components/ProtectedContent'
import { PERMISSIONS } from '@/lib/permissions'

export default function EditLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ProtectedContent requiredPermission={PERMISSIONS.WRITE_USERS}>
      <Container size="4">
        <Box mb="4">
          <UserPageHeader isEditMode />
        </Box>

        <NavigationGuardProvider>
          <TabNavigation isEditMode />
          <Separator size="4" my="4" />
          {children}
        </NavigationGuardProvider>
      </Container>
    </ProtectedContent>
  )
}
