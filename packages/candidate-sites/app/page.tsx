import WebsitePage from './[vanityPath]/components/WebsitePage';
import { Website } from './[vanityPath]/types/website.type'
import { fetchHelper } from '@/helpers/fetchHelper'
import { headers } from 'next/headers'

export const dynamic = 'force-dynamic'

async function getWebsiteByDomain({ domain }: { domain: string }): Promise<Website | null> {
  return await fetchHelper<Website>(`websites/by-domain/${domain}`)
}

export default async function Home() {
  const headersList = await headers()
  const host = headersList.get('host') || 'localhost'
  const website = await getWebsiteByDomain({ domain: host })

  if (!website) {
    return (
      <div className="font-sans grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20">
        <main className="flex flex-col gap-[32px] row-start-2 items-center sm:items-start">
          <h1 className="text-4xl font-bold">GoodParty.org Candidate Sites</h1>
        </main>
      </div>
    );
  }

  return <WebsitePage website={website} />
}
