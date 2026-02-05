import { Container, Box, Separator } from '@radix-ui/themes'
import { stubbedUserHeader } from '@/data/stubbed-user'
import { UserPageHeader } from '../components/UserPageHeader'
import { TabNavigation } from '../components/TabNavigation'

interface UserLayoutProps {
  children: React.ReactNode
  params: Promise<{ id: string }>
}

export default async function UserLayout({
  children,
  params,
}: UserLayoutProps) {
  const { id } = await params
  // TODO: Replace stubbed data with API call using id
  void id
  const headerData = stubbedUserHeader

  return (
    <Container size="4">
      <Box mb="4">
        <UserPageHeader user={headerData} />
      </Box>

      <TabNavigation userId={id} />

      <Separator size="4" my="4" />

      {children}
    </Container>
  )
}
