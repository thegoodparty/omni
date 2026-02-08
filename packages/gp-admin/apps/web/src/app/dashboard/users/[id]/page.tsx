import { Metadata } from 'next'
import { GoodPartyClient } from '@goodparty_org/sdk'
import { generateUrl } from '@/shared/util/generateUrl.util'
import { stubbedUser } from '@/data/stubbed-user'
import { UserSection } from './components/UserSection'
import { ViewLayout } from './components/ViewLayout'

export const metadata: Metadata = {
  title: 'User Details | GP Admin',
  description: 'View user details',
}

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function Page({ params }: PageProps) {
  const { id } = await params

  const {
    GP_ADMIN_MACHINE_SECRET,
    GP_API_PROTOCOL,
    GP_API_DOMAIN,
    GP_API_PORT,
    GP_API_ROOT_PATH,
  } = process.env

  if (!GP_ADMIN_MACHINE_SECRET) {
    throw new Error('GP_ADMIN_MACHINE_SECRET is not set')
  }

  if (!GP_API_PROTOCOL) {
    throw new Error('GP_API_PROTOCOL is not set')
  }

  if (!GP_API_DOMAIN) {
    throw new Error('GP_API_DOMAIN is not set')
  }

  const gpClient = await GoodPartyClient.create({
    m2mSecret: GP_ADMIN_MACHINE_SECRET,
    gpApiRootUrl: generateUrl({
      protocol: GP_API_PROTOCOL,
      domain: GP_API_DOMAIN,
      port: GP_API_PORT,
      rootPath: GP_API_ROOT_PATH,
    }).toString(),
  })

  console.log(`gpClient =>`, gpClient)

  const user = await gpClient.users.get(1)
  console.log(`user =>`, user)

  return (
    <ViewLayout userId={id}>
      <UserSection user={stubbedUser} />
    </ViewLayout>
  )
}
