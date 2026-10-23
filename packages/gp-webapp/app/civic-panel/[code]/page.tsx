import { notFound } from 'next/navigation'
import {
  CivicPanelJoinPageSchema,
  CivicPanelShareCodeSchema,
  type CivicPanelJoinPage,
} from '@goodparty_org/contracts'
import { GoodPartyOrgLogoWordmark } from '@styleguide'
import pageMetaData from 'helpers/metadataHelper'
import { buildUrl } from '@shared/utils/buildUrl'
import { MANAGED_PANEL_COPY } from 'app/dashboard/contacts/citizens-panel/managedPanelCopy'
import { JoinCivicPanelForm } from './JoinCivicPanelForm'

const COPY = MANAGED_PANEL_COPY.joinPage

export const dynamic = 'force-dynamic'

export const metadata = pageMetaData({
  title: 'Join the civic panel | GoodParty.org',
  description: 'Get a text about once a month asking what you think.',
  slug: '/civic-panel',
})

// Anonymous on purpose: no cookie and no token reach gp-api, which answers
// from the code alone.
const readJoinPage = async (
  code: string,
): Promise<CivicPanelJoinPage | null> => {
  const res = await fetch(
    buildUrl({
      path: `/civic-panel/join/${encodeURIComponent(code)}`,
      method: 'GET',
    }),
    { cache: 'no-store' },
  )
  if (!res.ok) return null
  return CivicPanelJoinPageSchema.parse(await res.json())
}

// The office's public civic panel join page, opened from the link the
// official shares. A resident joins without an account.
export default async function Page({
  params,
}: {
  params: Promise<{ code: string }>
}): Promise<React.JSX.Element> {
  const { code } = await params
  if (!CivicPanelShareCodeSchema.safeParse(code).success) notFound()
  const page = await readJoinPage(code)
  if (!page) notFound()

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <header className="flex items-center border-b border-base-border px-6 py-4">
        <GoodPartyOrgLogoWordmark size="small" textVariant="dark" />
      </header>
      <main className="flex flex-1 justify-center px-4 py-10 sm:px-6">
        <div className="flex w-full max-w-md flex-col gap-6">
          {page.open ? (
            <JoinCivicPanelForm
              code={code}
              title={COPY.title(page.officialName)}
              caption={COPY.caption(page.officeName, page.place)}
            />
          ) : (
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold text-foreground">
                {COPY.closedTitle}
              </h1>
              <p className="text-sm text-muted-foreground">
                {COPY.closedCaption}
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
